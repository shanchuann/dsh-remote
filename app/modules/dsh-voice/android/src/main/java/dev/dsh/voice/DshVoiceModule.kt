package dev.dsh.voice

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private data class VoiceAsset(val name: String, val path: String, val bytes: Long, val hash: String)
private val voiceAssets = listOf(
  VoiceAsset("model.int8.onnx", "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx", 239233841L, "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51"),
  VoiceAsset("tokens.txt", "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt", 315894L, "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc"),
  VoiceAsset("silero_vad.onnx", "csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx", 1807522L, "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28")
)

class DshVoiceModule : Module() {
  private val cancelled = AtomicBoolean(false)
  private val recording = AtomicBoolean(false)
  private val generation = AtomicInteger(0)
  private val preparing = AtomicBoolean(false)
  @Volatile private var verified = false
  @Volatile private var phase = "idle"
  @Volatile private var recorder: AudioRecord? = null
  private var capture: Thread? = null
  private var pcm = ByteArrayOutputStream()
  private var captureError: String? = null
  private val root: File get() = File(requireNotNull(appContext.reactContext).filesDir, "dsh-voice/sensevoice-int8")

  override fun definition() = ModuleDefinition {
    Name("DshVoice")
    View(MessageSelectionView::class) {
      Events("onQuote")
      Prop("enabled") { view: MessageSelectionView, enabled: Boolean -> view.setQuoteEnabled(enabled) }
    }
    Events("state")
    AsyncFunction("requestPermission") { promise: Promise ->
      if (ContextCompat.checkSelfPermission(requireNotNull(appContext.reactContext), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
        promise.resolve(mapOf("granted" to true))
      } else Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.RECORD_AUDIO)
    }
    AsyncFunction("status") {
      if (!preparing.get() && phase != "recording" && phase != "recognizing") {
        verified = voiceAssets.all { valid(File(root, it.name), it) }
      }
      state()
    }
    AsyncFunction("prepare") { origin: String -> prepare(origin) }
    Function("cancelDownload") { cancelled.set(true) }
    AsyncFunction("removeModels") {
      check(!preparing.get() && phase != "recording" && phase != "recognizing") { "请先结束语音输入或下载" }
      root.deleteRecursively()
      verified = false
      publish("idle")
    }
    AsyncFunction("startRecording") { startRecording() }
    AsyncFunction("stopRecording") { language: String ->
      check(phase == "recording") { "当前没有录音" }
      val ticket = generation.get()
      try {
      recording.set(false)
      runCatching { recorder?.stop() }
      capture?.join(5000)
      check(capture?.isAlive != true) { "录音设备没有及时停止" }
      captureError?.let { throw IllegalStateException(it) }
      val bytes = pcm.toByteArray()
      pcm.reset()
      publish("recognizing")
        val result = SenseVoiceEngine.recognize(root, bytes, language)
        check(ticket == generation.get()) { "语音输入已取消" }
        result
      } finally { pcm.reset(); publish(if (verified) "ready" else "idle") }
    }
    Function("cancelRecording") {
      generation.incrementAndGet()
      recording.set(false)
      runCatching { recorder?.stop() }
      if (phase == "recording") publish(if (verified) "ready" else "idle")
    }
    OnDestroy {
      generation.incrementAndGet()
      cancelled.set(true)
      recording.set(false)
      runCatching { recorder?.stop() }
    }
  }

  private fun state() = mapOf("phase" to phase, "ready" to verified, "bytes" to voiceAssets.sumOf { it.bytes })
  private fun publish(next: String, extra: Map<String, Any> = emptyMap()) {
    phase = next
    sendEvent("state", state() + extra)
  }
  private fun valid(file: File, asset: VoiceAsset): Boolean {
    if (!file.isFile || file.length() != asset.bytes) return false
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(128 * 1024)
      while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
    }
    return digest.digest().joinToString("") { "%02x".format(it) } == asset.hash
  }
  private fun prepare(origin: String) {
    check(origin == "https://huggingface.co" || origin == "https://hf-mirror.com") { "不支持此下载源" }
    check(phase != "recording" && phase != "recognizing") { "请先结束语音输入" }
    check(preparing.compareAndSet(false, true)) { "模型正在下载" }
    cancelled.set(false)
    try {
      root.mkdirs()
      val required = voiceAssets.sumOf { if (File(root, it.name).length() == it.bytes) 0L else it.bytes }
      check(root.usableSpace > required + 64L * 1024 * 1024) { "存储空间不足，请至少预留 300 MB" }
      var completed = 0L
      for (asset in voiceAssets) {
        check(!cancelled.get()) { "下载已取消" }
        val target = File(root, asset.name)
        publish("verifying", mapOf("file" to asset.name))
        if (!valid(target, asset)) {
          val partial = File(root, asset.name + ".part")
          val connection = URL(origin + "/" + asset.path).openConnection() as HttpURLConnection
          connection.connectTimeout = 15000; connection.readTimeout = 20000
          try {
            check(connection.responseCode in 200..299) { "下载失败 HTTP ${connection.responseCode}" }
            var downloaded = 0L; var reportedAt = 0L
            val deadline = System.currentTimeMillis() + 3600000L
            connection.inputStream.use { input -> FileOutputStream(partial).use { output ->
              val buffer = ByteArray(128 * 1024)
              while (true) {
                check(!cancelled.get()) { "下载已取消" }
                check(System.currentTimeMillis() < deadline) { "下载超时，请重试" }
                val count = input.read(buffer); if (count < 0) break
                downloaded += count
                check(downloaded <= asset.bytes) { "模型文件大小异常" }
                output.write(buffer, 0, count)
                if (System.currentTimeMillis() - reportedAt >= 250) {
                  publish("downloading", mapOf("downloaded" to completed + downloaded, "file" to asset.name))
                  reportedAt = System.currentTimeMillis()
                }
              }
              output.fd.sync()
            } }
            publish("verifying", mapOf("file" to asset.name))
            check(valid(partial, asset)) { "模型完整性校验失败，请重试或更换下载源" }
            check(!cancelled.get()) { "下载已取消" }
            check((!target.exists() || target.delete()) && partial.renameTo(target)) { "无法保存模型文件" }
          } finally { connection.disconnect(); partial.delete() }
        }
        completed += asset.bytes
      }
      verified = true
      publish("ready")
    } catch (error: Exception) {
      verified = false
      publish("idle", mapOf("error" to (error.message ?: "模型下载失败")))
      throw error
    } finally { preparing.set(false) }
  }

  @Suppress("MissingPermission")
  private fun startRecording() {
    check(verified) { "请先在设置中下载语音模型" }
    check(phase != "recording" && phase != "recognizing" && !preparing.get()) { "语音功能正在使用中" }
    check(ContextCompat.checkSelfPermission(requireNotNull(appContext.reactContext), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "需要麦克风权限" }
    capture?.join(1000)
    check(capture?.isAlive != true) { "上一次录音仍在结束，请稍后重试" }
    val size = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(size > 0) { "设备不支持 16 kHz 录音" }
    val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(size * 2, 8192))
    if (audio.state != AudioRecord.STATE_INITIALIZED) { audio.release(); error("无法打开麦克风") }
    pcm = ByteArrayOutputStream(); captureError = null; generation.incrementAndGet()
    val ticket = generation.get()
    recorder = audio; recording.set(true)
    try { audio.startRecording() } catch (error: Exception) { recording.set(false); audio.release(); recorder = null; throw error }
    publish("recording", mapOf("seconds" to 0))
    capture = Thread {
      val buffer = ByteArray(4096)
      try {
        var lastSecond = -1
        while (recording.get() && ticket == generation.get() && pcm.size() < 16000 * 2 * 90) {
          val count = audio.read(buffer, 0, buffer.size)
          if (count < 0) { if (recording.get()) captureError = "录音中断，请重试"; break }
          if (count > 0) pcm.write(buffer, 0, count)
          val second = pcm.size() / 32000
          if (second != lastSecond && recording.get() && ticket == generation.get()) { publish("recording", mapOf("seconds" to second)); lastSecond = second }
        }
      } finally { runCatching { audio.stop() }; audio.release(); recorder = null; recording.set(false) }
    }.also { it.start() }
  }

}
