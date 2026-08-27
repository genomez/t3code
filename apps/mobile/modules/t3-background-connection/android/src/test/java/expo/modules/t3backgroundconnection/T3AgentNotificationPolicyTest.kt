package expo.modules.t3backgroundconnection

import org.junit.Assert.assertEquals
import org.junit.Test

class T3AgentNotificationPolicyTest {
  @Test
  fun successfulReplyAcknowledgementExpiresBriefly() {
    assertEquals(
      5_000L,
      T3AgentNotificationPolicy.replyAcknowledgementTimeoutMs("Reply queued in T3 Code"),
    )
  }

  @Test
  fun failureAcknowledgementsRemainVisible() {
    assertEquals(
      null,
      T3AgentNotificationPolicy.replyAcknowledgementTimeoutMs("Reply not saved — open T3 Code"),
    )
  }
}
