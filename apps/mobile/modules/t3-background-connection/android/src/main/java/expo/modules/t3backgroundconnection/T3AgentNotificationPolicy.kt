package expo.modules.t3backgroundconnection

internal object T3AgentNotificationPolicy {
  const val REPLY_QUEUED_BODY = "Reply queued in T3 Code"
  const val REPLY_SUCCESS_TIMEOUT_MS = 5_000L

  fun replyAcknowledgementTimeoutMs(body: String): Long? =
    REPLY_SUCCESS_TIMEOUT_MS.takeIf { body == REPLY_QUEUED_BODY }
}
