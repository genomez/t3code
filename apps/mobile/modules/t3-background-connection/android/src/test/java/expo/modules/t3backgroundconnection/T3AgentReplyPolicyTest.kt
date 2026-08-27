package expo.modules.t3backgroundconnection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class T3AgentReplyPolicyTest {
  @Test
  fun `normalizes bounded replies without changing interior content`() {
    assertEquals(
      "Continue.\nPreserve this line.",
      T3AgentReplyPolicy.normalizeText("  Continue.\nPreserve this line.  "),
    )
    assertNull(T3AgentReplyPolicy.normalizeText("   "))
    assertNull(
      T3AgentReplyPolicy.normalizeText(
        "x".repeat(T3AgentReplyPolicy.MAX_REPLY_TEXT_LENGTH + 1),
      ),
    )
  }

  @Test
  fun `validates exact notification identities`() {
    assertTrue(T3AgentReplyPolicy.isValidIdentity("thread-1"))
    assertFalse(T3AgentReplyPolicy.isValidIdentity(""))
    assertFalse(T3AgentReplyPolicy.isValidIdentity(" "))
    assertFalse(
      T3AgentReplyPolicy.isValidIdentity(
        "x".repeat(T3AgentReplyPolicy.MAX_IDENTITY_LENGTH + 1),
      ),
    )
  }

  @Test
  fun `reply request codes include environment and thread identity`() {
    val first = T3AgentReplyPolicy.requestCode("tag", "environment-1", "thread-1")
    assertNotEquals(first, T3AgentReplyPolicy.requestCode("tag", "environment-2", "thread-1"))
    assertNotEquals(first, T3AgentReplyPolicy.requestCode("tag", "environment-1", "thread-2"))
  }
}
