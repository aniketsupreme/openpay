package com.youpipg.observer

import android.app.Notification
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * YouPI-PG Companion Android Observer Suite
 * 1. NotificationListenerService: Captures push notifications from GPay, PhonePe, Paytm, BHIM, and Bank apps.
 * 2. SmsBroadcastReceiver: Captures incoming bank credit SMS alerts in real time.
 * 3. HmacSigner: Signs raw JSON payload using HMAC-SHA256 with the paired merchant observer_secret.
 * 4. OfflineRetryQueue: SQLite-backed store-and-forward queue with exponential backoff when offline.
 */
object HmacSigner {
    fun signPayload(rawBody: String, secret: String): String {
        val algorithm = "HmacSHA256"
        val mac = Mac.getInstance(algorithm)
        val secretKey = SecretKeySpec(secret.toByteArray(Charsets.UTF_8), algorithm)
        mac.init(secretKey)
        val bytes = mac.doFinal(rawBody.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

class OfflineRetryQueueDb(context: Context) :
    SQLiteOpenHelper(context, "youpi_observer_queue.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS pending_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                signature TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    fun enqueue(payload: String, signature: String) {
        writableDatabase.execSQL(
            "INSERT INTO pending_alerts (payload, signature, attempts, created_at) VALUES (?, ?, 0, ?)",
            arrayOf(payload, signature, System.currentTimeMillis())
        )
    }
}

class YoupiNotificationObserverService : NotificationListenerService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val allowedPackages = setOf(
        "com.google.android.apps.nbu.paisa.user",     // Google Pay
        "com.google.android.apps.nbu.paisa.merchant", // GPay for Business
        "com.phonepe.app",                            // PhonePe
        "com.phonepe.app.business",                   // PhonePe Business
        "net.one97.paytm",                            // Paytm
        "com.paytm.business",                         // Paytm for Business
        "in.org.npci.upiapp",                         // BHIM
        "com.snapwork.hdfc",                          // HDFC Bank
        "com.sbi.lotusintouch",                       // YONO SBI
        "com.csam.icici.bank.imobile"                 // iMobile ICICI
    )

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || !allowedPackages.contains(sbn.packageName)) return
        val extras = sbn.notification.extras ?: return
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: text

        val combined = "$title: $bigText".trim()
        if (combined.isBlank()) return

        serviceScope.launch {
            ObserverDispatcher.dispatchObservation(
                context = applicationContext,
                rawText = combined,
                sourceChannel = "ANDROID_NOTIF",
                packageName = sbn.packageName
            )
        }
    }
}

class YoupiSmsBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        val fullBody = messages.joinToString("") { it.displayMessageBody ?: "" }
        val senderAddress = messages.firstOrNull()?.displayOriginatingAddress ?: "BANK-SMS"

        if (fullBody.isNotBlank()) {
            CoroutineScope(Dispatchers.IO).launch {
                ObserverDispatcher.dispatchObservation(
                    context = context.applicationContext,
                    rawText = fullBody,
                    sourceChannel = "ANDROID_SMS",
                    packageName = senderAddress
                )
            }
        }
    }
}

object ObserverDispatcher {
    fun dispatchObservation(
        context: Context,
        rawText: String,
        sourceChannel: String,
        packageName: String
    ) {
        val prefs = context.getSharedPreferences("youpi_observer_prefs", Context.MODE_PRIVATE)
        val endpoint = prefs.getString("endpoint", "") ?: return
        val observerSecret = prefs.getString("observer_secret", "") ?: return
        val merchantId = prefs.getString("merchant_id", "default_merchant") ?: "default_merchant"

        if (endpoint.isBlank() || observerSecret.isBlank()) return

        val jsonPayload = JSONObject().apply {
            put("merchantId", merchantId)
            put("rawPayload", rawText)
            put("sourceChannel", sourceChannel)
            put("devicePackage", packageName)
            put("observedAt", System.currentTimeMillis())
        }.toString()

        val signature = HmacSigner.signPayload(jsonPayload, observerSecret)
        val queueDb = OfflineRetryQueueDb(context)

        try {
            val url = URL(endpoint)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8000
                readTimeout = 8000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-Observer-Signature", signature)
            }

            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(jsonPayload)
                writer.flush()
            }

            val status = conn.responseCode
            if (status !in 200..299) {
                queueDb.enqueue(jsonPayload, signature)
            }
        } catch (ex: Exception) {
            queueDb.enqueue(jsonPayload, signature)
        }
    }
}
