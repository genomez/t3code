package expo.modules.t3backgroundconnection

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class T3BackgroundConnectionService : HeadlessJsTaskService() {
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onCreate() {
    super.onCreate()
    T3BackgroundConnectionState.initialize(this)
    startInForeground()
    T3BackgroundConnectionState.markServiceRunning(true)
    acquireWifiLock()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!T3BackgroundConnectionState.isEnabled(this)) {
      stopSelf(startId)
      return Service.START_NOT_STICKY
    }

    if (T3BackgroundConnectionState.claimTask()) {
      super.onStartCommand(intent, flags, startId)
    }
    return Service.START_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      T3BackgroundConnectionState.TASK_NAME,
      Arguments.createMap(),
      0,
      true,
    )

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    val shouldRestart = T3BackgroundConnectionState.isEnabled(this)
    T3BackgroundConnectionState.releaseTask()
    super.onHeadlessJsTaskFinish(taskId)
    if (shouldRestart) {
      T3BackgroundConnectionState.scheduleRestartAfterUnexpectedTaskFinish(this)
    }
  }

  override fun onDestroy() {
    releaseWifiLock()
    T3BackgroundConnectionState.markServiceRunning(false)
    super.onDestroy()
  }

  private fun startInForeground() {
    // Android validates the channel when startForeground() is called. Create
    // it before building/submitting the first foreground-service notification;
    // updateNotification() is too late on a fresh install.
    createNotificationChannel(this)
    val notification = buildNotification(this, DEFAULT_NOTIFICATION_TITLE, DEFAULT_NOTIFICATION_TEXT)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    const val DEFAULT_NOTIFICATION_TEXT = "Connected in background"
    const val NOTIFICATION_CHANNEL_ID = "t3code_background_connection"
    const val NOTIFICATION_ID = 0x7433

    internal fun updateNotification(context: Context, text: String?) {
      updateNotification(context, DEFAULT_NOTIFICATION_TITLE, text)
    }

    internal fun updateNotification(context: Context, title: String?, text: String?) {
      val applicationContext = context.applicationContext
      createNotificationChannel(applicationContext)
      applicationContext
        .getSystemService(NotificationManager::class.java)
        .notify(NOTIFICATION_ID, buildNotification(applicationContext, title, text))
    }

    private fun createNotificationChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val channel = NotificationChannel(
        NOTIFICATION_CHANNEL_ID,
        "Background connection",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Keeps T3 Code connected while the app is in the background"
        setSound(null, null)
        enableLights(false)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      }
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(context: Context, title: String?, text: String?): Notification {
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val contentIntent = launchIntent?.let {
        PendingIntent.getActivity(
          context,
          0,
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }
      val smallIcon =
        context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
          .takeIf { it != 0 }
          ?: android.R.drawable.stat_notify_sync_noanim

      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, NOTIFICATION_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }.apply {
        setContentTitle(normalizeNotificationTitle(title))
        setContentText(normalizeNotificationText(text))
        setSmallIcon(smallIcon)
        setOngoing(true)
        setOnlyAlertOnce(true)
        setShowWhen(false)
        setCategory(Notification.CATEGORY_SERVICE)
        setVisibility(Notification.VISIBILITY_PRIVATE)
        contentIntent?.let(::setContentIntent)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
          @Suppress("DEPRECATION")
          setPriority(Notification.PRIORITY_LOW)
          @Suppress("DEPRECATION")
          setSound(null)
        }
      }.build()
    }

    private fun normalizeNotificationText(text: String?): String {
      val normalized = text?.replace(Regex("\\s+"), " ")?.trim().orEmpty()
      return normalized.takeIf { it.isNotEmpty() }?.take(MAX_NOTIFICATION_TEXT_LENGTH)
        ?: DEFAULT_NOTIFICATION_TEXT
    }

    private fun normalizeNotificationTitle(title: String?): String {
      val normalized = title?.replace(Regex("\\s+"), " ")?.trim().orEmpty()
      return normalized.takeIf { it.isNotEmpty() }?.take(MAX_NOTIFICATION_TITLE_LENGTH)
        ?: DEFAULT_NOTIFICATION_TITLE
    }

    private const val MAX_NOTIFICATION_TEXT_LENGTH = 180
    private const val MAX_NOTIFICATION_TITLE_LENGTH = 96
    const val DEFAULT_NOTIFICATION_TITLE = "T3 Code"
  }

  @SuppressLint("WakelockTimeout")
  @Suppress("DEPRECATION")
  private fun acquireWifiLock() {
    try {
      val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      wifiLock = wifiManager.createWifiLock(
        WifiManager.WIFI_MODE_FULL_HIGH_PERF,
        "$packageName:t3-background-connection",
      ).apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (_: RuntimeException) {
      // The lock is best-effort. The foreground task and connection supervisor
      // remain authoritative on devices that reject or do not expose it.
      wifiLock = null
    }
  }

  private fun releaseWifiLock() {
    try {
      wifiLock?.takeIf { it.isHeld }?.release()
    } catch (_: RuntimeException) {
      // The system may already have released the lock during process teardown.
    } finally {
      wifiLock = null
    }
  }
}
