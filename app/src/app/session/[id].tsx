import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { BlurTargetView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "../../components/menu";
import {
  ApprovalSheet,
  ChatHeader,
  ChatSkeleton,
  Composer,
  ConnectionBanner,
  EmptyChat,
  ErrorToast,
  KeyboardAvoider,
  MessageList,
  ModelPicker,
  defaultSelection,
  normalizeModelCatalog,
  selectionKey,
  shortenPath,
} from "../../components/chat";
import type { MessageScrollerHandle } from "../../components/message-scroller";
import { useRemoteStore } from "../../lib/store";
import type { ModelSelection, PromptImage } from "../../lib/types";
import { buildTranscript } from "../../lib/transcript";
import { sessionSubagents } from "../../lib/projects";
import { TaskPanel } from "../../components/chat/task-panel";
import { SessionFilesProvider } from "../../components/chat/session-files";
import { SubagentSheet } from "../../components/chat/subagent-sheet";

/** Resolves expo-router's string | string[] param into a plain id. */
function useSessionIdParam(): string | undefined {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const raw = params.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** The overflow trigger: three quiet dots. */
function MoreDots() {
  return (
    <View className="flex-row items-center gap-[3px]">
      <View className="size-1 rounded-full bg-muted" />
      <View className="size-1 rounded-full bg-muted" />
      <View className="size-1 rounded-full bg-muted" />
    </View>
  );
}

/**
 * The chat screen: a live transcript of the open DSH session, a text composer
 * that turns into a stop button while a turn runs, and the blocking approval
 * card whenever the host needs a decision.
 */
export default function SessionScreen() {
  const sessionId = useSessionIdParam();
  const blurTarget = useRef<ComponentRef<typeof View> | null>(null);
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(insets.top + 56);
  const listRef = useRef<MessageScrollerHandle>(null);
  /** Whether the list is pinned to the newest message (message-scroller's state). */
  const followingRef = useRef(true);

  const teamTasks = useRemoteStore((state) => state.current.teamTasks);
  const todos = useRemoteStore((state) => state.current.todos);
  const title = useRemoteStore((state) => state.current.title);
  const running = useRemoteStore((state) => state.current.running);
  const events = useRemoteStore((state) => state.current.events);
  const streaming = useRemoteStore((state) => state.current.streaming);
  const pendingUser = useRemoteStore((state) => state.current.pendingUser);
  const imagePreviews = useRemoteStore((state) => state.current.imagePreviews);
  const [visit, setVisit] = useState(0);
  const pendingApprovals = useRemoteStore((state) => state.current.pendingApprovals);
  const loading = useRemoteStore((state) => state.current.loading);
  const hasMore = useRemoteStore((state) => state.current.hasMore);
  const sessionError = useRemoteStore((state) => state.current.error);
  const model = useRemoteStore((state) => state.current.model);
  const cwd = useRemoteStore((state) => state.current.cwd);
  const models = useRemoteStore((state) => state.models);
  const sessions = useRemoteStore((state) => state.sessions);
  const sessionsLoading = useRemoteStore((state) => state.sessionsLoading);
  const sessionsError = useRemoteStore((state) => state.sessionsError);
  const connection = useRemoteStore((state) => state.connection);
  const host = useRemoteStore((state) => state.host);
  const actions = useRemoteStore((state) => state.actions);

  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const [showTurns, setShowTurns] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const connected = connection.status === "connected";
  // Only the focused screen owns a subscription. A parent remains mounted
  // while viewing a child task and must not take the shared store back.
  useFocusEffect(useCallback(() => {
    if (!sessionId || !connected) return;
    followingRef.current = true;
    setVisit((value) => value + 1);
    void actions.openSession(sessionId);
    return () => { void actions.closeSession(); };
  }, [actions, connected, sessionId]));

  const items = useMemo(
    () => buildTranscript(events, streaming, { pending: pendingUser, imagePreviews }),
    [events, pendingUser, streaming, imagePreviews],
  );

  const groups = useMemo(() => normalizeModelCatalog(models), [models]);
  const selection: ModelSelection | undefined = model ?? defaultSelection(models);
  const subagents = useMemo(() => sessionSubagents(sessions, sessionId), [sessions, sessionId]);
  const subtitleSource =
    cwd ?? sessions.find((row) => row.sessionId === sessionId)?.cwd ?? host?.defaultCwd;
  const subtitle = subtitleSource ? shortenPath(subtitleSource, 44) : undefined;
  const pendingApproval = pendingApprovals[0];

  const errorMessage = sessionError ?? connection.error;

  // Errors are transient: fade the toast out on its own.
  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => actions.clearError(), 7000);
    return () => clearTimeout(timer);
  }, [actions, errorMessage]);

  useEffect(() => {
    if (pickerOpen && !models) void actions.loadModels();
  }, [actions, models, pickerOpen]);

  useEffect(() => {
    if (!subagentsOpen || !connected) return;
    void actions.refreshSessions();
    const timer = setInterval(() => void actions.refreshSessions(), 5000);
    return () => clearInterval(timer);
  }, [actions, connected, subagentsOpen]);

  const send = (text: string, images?: PromptImage[]) => {
    const trimmed = text.trim();
    if (!trimmed && (images === undefined || images.length === 0)) return;
    setDraft("");
    listRef.current?.scrollToEnd();
    void actions.sendPrompt(trimmed, { images });
  };

  const pickSuggestion = (text: string) => {
    setDraft(text);
    send(text);
  };

  const selectModel = (next: ModelSelection) => {
    setPickerOpen(false);
    if (selectionKey(next) === selectionKey(selection)) return;
    void actions.selectModel(next);
  };

  const handleFollowChange = useCallback((following: boolean) => {
    followingRef.current = following;
  }, []);

  // The message list shrinks when the keyboard opens; keep the newest message
  // in view unless the reader had scrolled up on purpose.
  const handleKeyboardInset = useCallback((inset: number) => {
    if (inset > 0 && followingRef.current) listRef.current?.scrollToEnd();
  }, []);

  const loadOlder = () => {
    if (!hasMore || loadingOlder) return;
    setLoadingOlder(true);
    void actions
      .loadOlderHistory()
      .finally(() => setLoadingOlder(false));
  };

  const answer = (decision: "allow" | "reject") => {
    if (!pendingApproval) return;
    const id = pendingApproval.id;
    setAnswering(id);
    void actions
      .answerApproval(id, decision)
      .finally(() => setAnswering((current) => (current === id ? null : current)));
  };

  const showSkeleton = loading && items.length === 0;
  const showEmpty = !loading && !running && items.length === 0;

  return (
    <SessionFilesProvider key={sessionId} sessionId={sessionId}><View className="flex-1 bg-background">
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
      <View style={connected ? undefined : { paddingTop: headerHeight }}>
      <ConnectionBanner
        status={connection.status}
        error={connection.status === "error" ? connection.error : undefined}
        needsPairing={connection.needsPairing === true}
        onRepair={() => router.replace("/")}
      />
      </View>
      <KeyboardAvoider
        className="flex-1"
        onInsetChange={handleKeyboardInset}
      >
        {showSkeleton ? (
          <View className="flex-1" style={{ paddingTop: headerHeight }}><ChatSkeleton /></View>
        ) : showEmpty ? (
          <View className="flex-1" style={{ paddingTop: headerHeight }}><EmptyChat onPick={pickSuggestion} /></View>
        ) : (
          <MessageList
            topInset={connected ? headerHeight + 16 : 0}
            key={sessionId + ':' + visit}
            ref={listRef}
            items={items}
            running={running}
            streaming={streaming.text.length > 0}
            showTurns={showTurns}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlder}
            onFollowChange={handleFollowChange}
          />
        )}
        {showSkeleton ? null : <TaskPanel key={sessionId} value={todos} teamTasks={teamTasks} />}
        {pendingApproval ? (
          <ApprovalSheet
            approval={pendingApproval}
            submitting={answering === pendingApproval.id}
            pendingCount={pendingApprovals.length}
            onAllow={() => answer("allow")}
            onReject={() => answer("reject")}
          />
        ) : null}
        {showSkeleton ? null : (
          <Composer
            value={draft}
            onValueChange={setDraft}
            onSend={send}
            onStop={() => void actions.cancel()}
            running={running}
            disabled={!sessionId || connection.status !== "connected"}
            placeholder={running ? "运行中，点右侧停止…" : "给 DSH 发消息…"}
          />
        )}
      </KeyboardAvoider>
      </BlurTargetView>
      <ChatHeader
        blurTarget={blurTarget}
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        title={title?.trim() || "新会话"}
        subtitle={subtitle}
        subagentCount={subagents.length}
        subagentsRunning={subagents.some((agent) => agent.running)}
        running={running}
        connected={connected}
        onBack={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/sessions");
        }}
        onPressSubagents={() => setSubagentsOpen(true)}
        trailing={
          <Menu>
            <MenuTrigger accessibilityLabel="更多选项">
              <View className="size-12 items-center justify-center rounded-full active:bg-surface">
                <MoreDots />
              </View>
            </MenuTrigger>
            <MenuContent align="end" width={220}>
              <MenuItem onSelect={() => setPickerOpen(true)}>切换模型</MenuItem>
              <MenuSeparator />
              <MenuCheckboxItem checked={showTurns} onCheckedChange={setShowTurns}>
                显示轮次分隔
              </MenuCheckboxItem>
            </MenuContent>
          </Menu>
        }
      />
      <ModelPicker
        visible={pickerOpen}
        groups={groups}
        selected={selection}
        loading={models === undefined}
        onSelect={selectModel}
        onClose={() => setPickerOpen(false)}
      />
      <SubagentSheet
        visible={subagentsOpen}
        agents={subagents}
        loading={sessionsLoading}
        error={sessionsError}
        onClose={() => setSubagentsOpen(false)}
        onRefresh={() => void actions.refreshSessions()}
        onOpen={(id) => {
          setSubagentsOpen(false);
          router.push({ pathname: '/session/[id]', params: { id } });
        }}
      />
      <ErrorToast
        message={errorMessage}
        onDismiss={() => actions.clearError()}
      />
    </View></SessionFilesProvider>
  );
}
