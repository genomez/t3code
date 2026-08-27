package expo.modules.t3backgroundconnection

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

class T3AgentReplyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val applicationContext = context.applicationContext
    val tag = intent.getStringExtra(EXTRA_NOTIFICATION_TAG)
    if (intent.action == ACTION_DISMISS) {
      tag?.takeIf(T3BackgroundConnectionService::isAgentNotificationTag)?.let { validTag ->
        T3BackgroundConnectionService.dismissAgentNotification(applicationContext, validTag)
      }
      return
    }

    val environmentId = intent.getStringExtra(EXTRA_ENVIRONMENT_ID)
    val threadId = intent.getStringExtra(EXTRA_THREAD_ID)
    if (intent.action == ACTION_MARK_AS_READ) {
      if (
        T3BackgroundConnectionService.isAgentNotificationTag(tag) &&
        T3AgentReplyPolicy.isValidIdentity(environmentId) &&
        T3AgentReplyPolicy.isValidIdentity(threadId)
      ) {
        T3BackgroundConnectionService.dismissAgentNotification(applicationContext, checkNotNull(tag))
      }
      return
    }
    if (intent.action != ACTION_REPLY) return

    val title = intent.getStringExtra(EXTRA_NOTIFICATION_TITLE)
    val deepLink = intent.getStringExtra(EXTRA_DEEP_LINK)
    val text = T3AgentReplyPolicy.normalizeText(
      RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_TEXT_REPLY),
    )

    if (
      !T3BackgroundConnectionService.isAgentNotificationTag(tag) ||
      !T3AgentReplyPolicy.isValidIdentity(environmentId) ||
      !T3AgentReplyPolicy.isValidIdentity(threadId) ||
      text == null ||
      title == null ||
      deepLink == null
    ) {
      tag?.takeIf(T3BackgroundConnectionService::isAgentNotificationTag)?.let { validTag ->
        T3BackgroundConnectionService.updateAgentNotificationAfterReply(
          applicationContext,
          validTag,
          title ?: T3BackgroundConnectionService.DEFAULT_NOTIFICATION_TITLE,
          "Reply not sent — open T3 Code",
          deepLink,
        )
      }
      return
    }

    val validTag = checkNotNull(tag)
    val validTitle = checkNotNull(title)
    val validDeepLink = checkNotNull(deepLink)
    val reply = T3AgentReplyStore.enqueue(
      applicationContext,
      checkNotNull(environmentId),
      checkNotNull(threadId),
      text,
    )
    if (reply == null) {
      T3BackgroundConnectionService.updateAgentNotificationAfterReply(
        applicationContext,
        validTag,
        validTitle,
        "Reply not saved — open T3 Code",
        validDeepLink,
      )
      return
    }

    T3BackgroundConnectionService.updateAgentNotificationAfterReply(
      applicationContext,
      validTag,
      validTitle,
      T3AgentNotificationPolicy.REPLY_QUEUED_BODY,
      validDeepLink,
      T3AgentNotificationPolicy.replyAcknowledgementTimeoutMs(
        T3AgentNotificationPolicy.REPLY_QUEUED_BODY,
      ),
    )
    T3BackgroundConnectionState.initialize(applicationContext)
    T3BackgroundConnectionState.emitAgentReplyAvailable()
    T3BackgroundConnectionController.ensureStarted(applicationContext)
  }

  companion object {
    const val ACTION_REPLY =
      "expo.modules.t3backgroundconnection.action.REPLY_TO_AGENT"
    const val ACTION_MARK_AS_READ =
      "expo.modules.t3backgroundconnection.action.MARK_AGENT_RESPONSE_READ"
    const val ACTION_DISMISS =
      "expo.modules.t3backgroundconnection.action.DISMISS_AGENT_NOTIFICATION"
    const val KEY_TEXT_REPLY = "t3_agent_reply_text"
    const val EXTRA_NOTIFICATION_TAG = "notificationTag"
    const val EXTRA_NOTIFICATION_TITLE = "notificationTitle"
    const val EXTRA_DEEP_LINK = "deepLink"
    const val EXTRA_ENVIRONMENT_ID = "environmentId"
    const val EXTRA_THREAD_ID = "threadId"
  }
}
