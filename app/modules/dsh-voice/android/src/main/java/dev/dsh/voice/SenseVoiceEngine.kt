package dev.dsh.voice

import com.k2fsa.sherpa.onnx.*
import java.io.File

internal object SenseVoiceEngine {
  fun recognize(root: File, bytes: ByteArray, language: String): String {
    check(language in listOf("auto", "zh", "en", "yue", "ja", "ko")) { "不支持的识别语言" }
    if (bytes.size < 8000) return ""
    val samples = FloatArray(bytes.size / 2) { i ->
      ((bytes[i * 2].toInt() and 255) or (bytes[i * 2 + 1].toInt() shl 8)).toShort().toFloat() / 32768f
    }
    val recognizer = OfflineRecognizer(config = OfflineRecognizerConfig(modelConfig = OfflineModelConfig(
      senseVoice = OfflineSenseVoiceModelConfig(model = File(root, "model.int8.onnx").absolutePath, language = language, useInverseTextNormalization = true),
      tokens = File(root, "tokens.txt").absolutePath, numThreads = 2, provider = "cpu"
    )))
    try {
      val vad = Vad(config = VadModelConfig(sileroVadModelConfig = SileroVadModelConfig(
        model = File(root, "silero_vad.onnx").absolutePath, minSilenceDuration = 0.5f, maxSpeechDuration = 30f
      ), numThreads = 2))
      try {
        val texts = mutableListOf<String>()
        var first = true
        fun drain() {
          while (!vad.empty()) {
            val segment = vad.front()
            val from = if (first) maxOf(0, segment.start.toInt() - 4800) else segment.start.toInt()
            first = false
            val speech = samples.copyOfRange(from, minOf(samples.size, segment.start.toInt() + segment.samples.size))
            val stream = recognizer.createStream()
            try { stream.acceptWaveform(speech, 16000); recognizer.decode(stream); texts.add(recognizer.getResult(stream).text.trim()) }
            finally { stream.release() }
            vad.pop()
          }
        }
        var offset = 0
        while (offset < samples.size) { vad.acceptWaveform(samples.copyOfRange(offset, minOf(offset + 512, samples.size))); drain(); offset += 512 }
        vad.flush(); drain()
        return texts.filter { it.isNotEmpty() }.joinToString(" ").replace(Regex("<\\|[^|]*\\|>"), "").trim()
      } finally { vad.release() }
    } finally { recognizer.release() }
  }
}
