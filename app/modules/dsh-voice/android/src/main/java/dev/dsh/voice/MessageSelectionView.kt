package dev.dsh.voice

import android.content.Context
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.WeakHashMap

/** Adds quoting to the native selection toolbar of the rendered message text. */
class MessageSelectionView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onQuote by EventDispatcher()
  private val callbacks = WeakHashMap<TextView, ActionMode.Callback?>()
  private val quoteId = View.generateViewId()
  private var quoteEnabled = false

  fun setQuoteEnabled(enabled: Boolean) {
    quoteEnabled = enabled
    post { bindTextActions(this) }
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    post { bindTextActions(child) }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    post { bindTextActions(this) }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    bindTextActions(this)
  }

  override fun onDetachedFromWindow() {
    callbacks.forEach { (text, callback) -> text.customSelectionActionModeCallback = callback }
    callbacks.clear()
    super.onDetachedFromWindow()
  }

  private fun selectedText(text: TextView): String {
    val start = minOf(text.selectionStart, text.selectionEnd)
    val end = maxOf(text.selectionStart, text.selectionEnd)
    return if (start >= 0 && end > start && end <= text.text.length) text.text.subSequence(start, end).toString() else ""
  }

  private fun bindTextActions(view: View) {
    if (view is TextView && view.isTextSelectable && !callbacks.containsKey(view)) {
      callbacks[view] = view.customSelectionActionModeCallback
      view.customSelectionActionModeCallback = object : ActionMode.Callback {
        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
          menu.clear()
          menu.add(Menu.NONE, android.R.id.copy, 0, "复制").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
          menu.add(Menu.NONE, quoteId, 1, "引用").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
          menu.add(Menu.NONE, android.R.id.selectAll, 2, "全选").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
          return true
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
          menu.findItem(quoteId)?.isVisible = quoteEnabled && selectedText(view).isNotBlank()
          return true
        }

        override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
          if (item.itemId == quoteId) {
            val selected = selectedText(view)
            if (quoteEnabled && selected.isNotBlank()) onQuote(mapOf("text" to selected))
            mode.finish()
            return true
          }
          return view.onTextContextMenuItem(item.itemId)
        }

        override fun onDestroyActionMode(mode: ActionMode) {}
      }
    }
    if (view is ViewGroup) for (index in 0 until view.childCount) bindTextActions(view.getChildAt(index))
  }
}
