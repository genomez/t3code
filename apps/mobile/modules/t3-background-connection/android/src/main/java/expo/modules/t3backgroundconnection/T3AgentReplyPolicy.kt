package expo.modules.t3backgroundconnection

internal object T3AgentReplyPolicy {
  const val MAX_REPLY_TEXT_LENGTH = 16_384
  const val MAX_IDENTITY_LENGTH = 512

  fun normalizeText(value: CharSequence?): String? {
    val normalized = value?.toString()?.trim().orEmpty()
    return normalized.takeIf { it.isNotEmpty() && it.length <= MAX_REPLY_TEXT_LENGTH }
  }

  fun isValidIdentity(value: String?): Boolean =
    value != null && value.isNotBlank() && value.length <= MAX_IDENTITY_LENGTH

  fun requestCode(tag: String, environmentId: String, threadId: String): Int =
    listOf(tag, environmentId, threadId, "reply").joinToString("\u0000").hashCode()
}
