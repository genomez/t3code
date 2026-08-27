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
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
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
    private const val AGENT_NOTIFICATION_CHANNEL_ID = "t3-agent-updates"
    private const val AGENT_NOTIFICATION_GROUP = "t3-agent-updates"
    private const val AGENT_NOTIFICATION_TAG_PREFIX = "t3-agent-"
    private const val AGENT_NOTIFICATION_SUMMARY_TAG = "t3-agent-summary"
    private const val AGENT_NOTIFICATION_SUMMARY_ID = 0x7434

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

    /**
     * Completion notifications are posted through a stable tag/id pair. This
     * replaces the older alert for the same thread without touching alerts for
     * other threads or the foreground-service notification.
     */
    internal fun postAgentNotification(
      context: Context,
      tag: String,
      title: String,
      body: String,
      deepLink: String,
      environmentId: String,
      threadId: String,
    ) {
      val applicationContext = context.applicationContext
      createAgentNotificationChannel(applicationContext)
      val notificationUri = Uri.parse(deepLink)
      require(notificationUri.isAbsolute) {
        "Agent notification deep links must be absolute URIs"
      }
      require(T3AgentReplyPolicy.isValidIdentity(environmentId)) {
        "Agent notification environment identifiers must be non-empty"
      }
      require(T3AgentReplyPolicy.isValidIdentity(threadId)) {
        "Agent notification thread identifiers must be non-empty"
      }
      val contentIntent = agentContentIntent(applicationContext, tag, notificationUri)
      val replyAction = buildAgentReplyAction(
        applicationContext,
        tag,
        title,
        notificationUri,
        environmentId,
        threadId,
      )
      val markAsReadAction = buildAgentMarkAsReadAction(
        applicationContext,
        tag,
        notificationUri,
        environmentId,
        threadId,
      )
      val deleteIntent = buildAgentDeleteIntent(applicationContext, tag)
      val notification = buildAgentNotification(
        applicationContext,
        title,
        body,
        contentIntent,
        replyAction,
        markAsReadAction,
        deleteIntent,
        isSummary = false,
        isAutomotiveMessage = true,
      )
      val manager = applicationContext.getSystemService(NotificationManager::class.java)
      manager.notify(tag, 0, notification)
      manager.notify(
        AGENT_NOTIFICATION_SUMMARY_TAG,
        AGENT_NOTIFICATION_SUMMARY_ID,
        buildAgentNotification(
          applicationContext,
          title,
          body,
          contentIntent,
          replyAction = null,
          markAsReadAction = null,
          deleteIntent = null,
          isSummary = true,
          isAutomotiveMessage = false,
        ),
      )
    }

    internal fun updateAgentNotificationAfterReply(
      context: Context,
      tag: String,
      title: String,
      body: String,
      deepLink: String?,
      timeoutAfterMs: Long? = null,
    ) {
      val applicationContext = context.applicationContext
      createAgentNotificationChannel(applicationContext)
      val notificationUri = deepLink?.let(Uri::parse)?.takeIf { it.isAbsolute } ?: return
      applicationContext.getSystemService(NotificationManager::class.java).notify(
        tag,
        0,
        buildAgentNotification(
          applicationContext,
          title,
          body,
          agentContentIntent(applicationContext, tag, notificationUri),
          replyAction = null,
          markAsReadAction = null,
          deleteIntent = buildAgentDeleteIntent(applicationContext, tag),
          isSummary = false,
          isAutomotiveMessage = false,
          timeoutAfterMs = timeoutAfterMs,
        ),
      )
    }

    internal fun isAgentNotificationTag(tag: String?): Boolean =
      tag?.startsWith(AGENT_NOTIFICATION_TAG_PREFIX) == true

    /** Remove a single completion alert and its summary only when empty. */
    internal fun dismissAgentNotification(context: Context, tag: String) {
      val applicationContext = context.applicationContext
      val manager = applicationContext.getSystemService(NotificationManager::class.java)
      manager.cancel(tag, 0)
      val hasRemainingAgentNotification = manager.activeNotifications.any {
        it.packageName == applicationContext.packageName &&
          it.id == 0 &&
          it.tag?.startsWith(AGENT_NOTIFICATION_TAG_PREFIX) == true
      }
      if (!hasRemainingAgentNotification) {
        manager.cancel(AGENT_NOTIFICATION_SUMMARY_TAG, AGENT_NOTIFICATION_SUMMARY_ID)
      }
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

    private fun createAgentNotificationChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val channel = NotificationChannel(
        AGENT_NOTIFICATION_CHANNEL_ID,
        "T3 agent updates",
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        enableLights(true)
        lightColor = 0xff7565c7.toInt()
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 250, 250, 250)
        setShowBadge(true)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildAgentNotification(
      context: Context,
      title: String,
      body: String,
      contentIntent: PendingIntent,
      replyAction: NotificationCompat.Action?,
      markAsReadAction: NotificationCompat.Action?,
      deleteIntent: PendingIntent?,
      isSummary: Boolean,
      isAutomotiveMessage: Boolean,
      timeoutAfterMs: Long? = null,
    ): Notification {
      val smallIcon =
        context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
          .takeIf { it != 0 }
          ?: android.R.drawable.stat_notify_sync_noanim
      val normalizedTitle = normalizeNotificationTitle(title)
      val normalizedBody = normalizeNotificationText(body)
      return NotificationCompat.Builder(context, AGENT_NOTIFICATION_CHANNEL_ID).apply {
        setContentTitle(normalizedTitle)
        setContentText(normalizedBody)
        setSmallIcon(smallIcon)
        setColor(0xff7565c7.toInt())
        setAutoCancel(!isSummary)
        setOnlyAlertOnce(true)
        setShowWhen(true)
        setGroup(AGENT_NOTIFICATION_GROUP)
        setContentIntent(contentIntent)
        deleteIntent?.let(::setDeleteIntent)
        replyAction?.let(::addAction)
        markAsReadAction?.let(::addInvisibleAction)
        timeoutAfterMs?.let(::setTimeoutAfter)
        if (isAutomotiveMessage) {
          val deviceUser = Person.Builder().setName("You").build()
          val agent = Person.Builder().setName("T3 agent").build()
          setCategory(NotificationCompat.CATEGORY_MESSAGE)
          setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
          setStyle(
            NotificationCompat.MessagingStyle(deviceUser)
              .setConversationTitle(normalizedTitle)
              .setGroupConversation(true)
              .addMessage(normalizedBody, System.currentTimeMillis(), agent),
          )
        } else {
          setStyle(NotificationCompat.BigTextStyle().bigText(normalizedBody))
        }
        if (isSummary) {
          setGroupSummary(true)
          setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        }
        setPriority(NotificationCompat.PRIORITY_HIGH)
      }.build()
    }

    private fun agentContentIntent(
      context: Context,
      tag: String,
      notificationUri: Uri,
    ): PendingIntent {
      val launchIntent = Intent(Intent.ACTION_VIEW, notificationUri).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      return PendingIntent.getActivity(
        context,
        tag.hashCode(),
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun buildAgentReplyAction(
      context: Context,
      tag: String,
      title: String,
      notificationUri: Uri,
      environmentId: String,
      threadId: String,
    ): NotificationCompat.Action {
      val replyIntent = Intent(context, T3AgentReplyReceiver::class.java).apply {
        action = T3AgentReplyReceiver.ACTION_REPLY
        // Extras do not participate in PendingIntent identity. A private,
        // thread-specific data URI keeps simultaneous reply actions distinct.
        data = Uri.Builder()
          .scheme("t3-agent-reply")
          .authority(context.packageName)
          .appendPath(environmentId)
          .appendPath(threadId)
          .build()
        putExtra(T3AgentReplyReceiver.EXTRA_NOTIFICATION_TAG, tag)
        putExtra(T3AgentReplyReceiver.EXTRA_NOTIFICATION_TITLE, title)
        putExtra(T3AgentReplyReceiver.EXTRA_DEEP_LINK, notificationUri.toString())
        putExtra(T3AgentReplyReceiver.EXTRA_ENVIRONMENT_ID, environmentId)
        putExtra(T3AgentReplyReceiver.EXTRA_THREAD_ID, threadId)
      }
      val replyPendingIntent = PendingIntent.getBroadcast(
        context,
        T3AgentReplyPolicy.requestCode(tag, environmentId, threadId),
        replyIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      val remoteInput = RemoteInput.Builder(T3AgentReplyReceiver.KEY_TEXT_REPLY)
        .setLabel("Reply to T3")
        .build()
      return NotificationCompat.Action.Builder(
        android.R.drawable.ic_menu_send,
        "Reply",
        replyPendingIntent,
      ).apply {
        addRemoteInput(remoteInput)
        setAllowGeneratedReplies(true)
        setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        setShowsUserInterface(false)
        setAuthenticationRequired(true)
      }.build()
    }

    private fun buildAgentMarkAsReadAction(
      context: Context,
      tag: String,
      notificationUri: Uri,
      environmentId: String,
      threadId: String,
    ): NotificationCompat.Action {
      val markAsReadIntent = Intent(context, T3AgentReplyReceiver::class.java).apply {
        action = T3AgentReplyReceiver.ACTION_MARK_AS_READ
        data = Uri.Builder()
          .scheme("t3-agent-read")
          .authority(context.packageName)
          .appendPath(environmentId)
          .appendPath(threadId)
          .build()
        putExtra(T3AgentReplyReceiver.EXTRA_NOTIFICATION_TAG, tag)
        putExtra(T3AgentReplyReceiver.EXTRA_DEEP_LINK, notificationUri.toString())
        putExtra(T3AgentReplyReceiver.EXTRA_ENVIRONMENT_ID, environmentId)
        putExtra(T3AgentReplyReceiver.EXTRA_THREAD_ID, threadId)
      }
      val pendingIntent = PendingIntent.getBroadcast(
        context,
        T3AgentReplyPolicy.requestCode(tag, environmentId, threadId),
        markAsReadIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return NotificationCompat.Action.Builder(
        android.R.drawable.ic_menu_view,
        "Mark as read",
        pendingIntent,
      ).apply {
        setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
        setShowsUserInterface(false)
      }.build()
    }

    private fun buildAgentDeleteIntent(context: Context, tag: String): PendingIntent {
      val deleteIntent = Intent(context, T3AgentReplyReceiver::class.java).apply {
        action = T3AgentReplyReceiver.ACTION_DISMISS
        data = Uri.Builder()
          .scheme("t3-agent-dismiss")
          .authority(context.packageName)
          .appendPath(tag)
          .build()
        putExtra(T3AgentReplyReceiver.EXTRA_NOTIFICATION_TAG, tag)
      }
      return PendingIntent.getBroadcast(
        context,
        tag.hashCode(),
        deleteIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
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
