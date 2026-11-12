package dev.dsh.voice

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

@RunWith(AndroidJUnit4::class)
class SenseVoiceTest {
  @Test fun recognizesOfficialMandarinFixtureLocally() {
    val test = InstrumentationRegistry.getInstrumentation().context
    val root = File(test.filesDir, "models").apply { mkdirs() }
    for (name in listOf("model.int8.onnx", "tokens.txt", "silero_vad.onnx")) {
      test.assets.open(name).use { input -> File(root, name).outputStream().use { input.copyTo(it) } }
    }
    val wav = test.assets.open("zh.wav").use { it.readBytes() }
    val buffer = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
    var offset = 12
    while (String(wav, offset, 4, Charsets.US_ASCII) != "data") offset += 8 + buffer.getInt(offset + 4) + (buffer.getInt(offset + 4) and 1)
    val pcm = wav.copyOfRange(offset + 8, offset + 8 + buffer.getInt(offset + 4))
    val text = SenseVoiceEngine.recognize(root, pcm, "zh")
    println("DSH_VOICE_RESULT=" + text)
    assertTrue("Expected Mandarin output, got: " + text, text.contains("时间") && text.contains("早上9点") && text.contains("下午5点"))
    assertEquals("", SenseVoiceEngine.recognize(root, ByteArray(32000), "auto"))
  }
}
