package expo.modules.t3backgroundconnection

import android.content.Context
import org.json.JSONObject
import java.util.UUID

internal data class T3AgentReply(
  val replyId: String,
  val environmentId: String,
  val threadId: String,
  val text: String,
  val createdAtEpochMs: Long,
) {
  fun toMap(): Map<String, Any> = mapOf(
    "replyId" to replyId,
    "environmentId" to environmentId,
    "threadId" to threadId,
    "text" to text,
    "createdAtEpochMs" to createdAtEpochMs.toDouble(),
  )
}

internal object T3AgentReplyStore {
  private const val PREFERENCES_NAME = "t3_agent_notification_replies"
  private const val REPLIES_KEY = "pending_replies"
  private const val MAX_PENDING_REPLIES = 50
  private val lock = Any()

  fun enqueue(
    context: Context,
    environmentId: String,
    threadId: String,
    text: String,
  ): T3AgentReply? = synchronized(lock) {
    val preferences = preferences(context)
    val pending = encodedReplies(preferences)
    if (pending.size >= MAX_PENDING_REPLIES) return@synchronized null

    val reply = T3AgentReply(
      replyId = UUID.randomUUID().toString(),
      environmentId = environmentId,
      threadId = threadId,
      text = text,
      createdAtEpochMs = System.currentTimeMillis(),
    )
    pending.add(encode(reply))
    if (!preferences.edit().putStringSet(REPLIES_KEY, pending).commit()) {
      return@synchronized null
    }
    reply
  }

  fun pending(context: Context): List<T3AgentReply> = synchronized(lock) {
    encodedReplies(preferences(context))
      .mapNotNull(::decode)
      .sortedWith(compareBy(T3AgentReply::createdAtEpochMs, T3AgentReply::replyId))
  }

  fun acknowledge(context: Context, replyId: String): Boolean = synchronized(lock) {
    val preferences = preferences(context)
    val pending = encodedReplies(preferences)
    val retained = pending.filterTo(linkedSetOf()) { encoded ->
      decode(encoded)?.replyId != replyId
    }
    if (retained.size == pending.size) return@synchronized true
    preferences.edit().putStringSet(REPLIES_KEY, retained).commit()
  }

  private fun preferences(context: Context) =
    context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  private fun encodedReplies(preferences: android.content.SharedPreferences): LinkedHashSet<String> =
    LinkedHashSet(preferences.getStringSet(REPLIES_KEY, emptySet()).orEmpty())

  private fun encode(reply: T3AgentReply): String = JSONObject()
    .put("replyId", reply.replyId)
    .put("environmentId", reply.environmentId)
    .put("threadId", reply.threadId)
    .put("text", reply.text)
    .put("createdAtEpochMs", reply.createdAtEpochMs)
    .toString()

  private fun decode(encoded: String): T3AgentReply? = runCatching {
    val json = JSONObject(encoded)
    T3AgentReply(
      replyId = json.getString("replyId"),
      environmentId = json.getString("environmentId"),
      threadId = json.getString("threadId"),
      text = json.getString("text"),
      createdAtEpochMs = json.getLong("createdAtEpochMs"),
    )
  }.getOrNull()
}
