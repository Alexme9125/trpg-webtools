import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Armchair,
  FileText,
  BookOpen,
  ArrowLeft,
  Menu,
  X,
  CircleHelp,
  PanelsTopLeft,
} from 'lucide-react';
import type {
  Character,
  CreateRoomInput,
  JoinRoomInput,
  Room,
  RoomConnection,
  RoomAction,
  RuleId,
  Session,
} from '../shared/types';
import { act, createRoom, getStatus, joinRoom, resumeRoom, socket } from './api';
import { getLibrary, getSession, readStored, saveToLibrary, writeStored } from './storage';
import { Logo, ThemeToggle, Toast, Spinner } from './components/ui';
import { Gateway, Library, RuleSelection, RulesModal } from './components/Lobby';
import { CharacterEditor } from './components/CharacterEditor';
import { RoomView } from './components/RoomView';
const HostToolkit = lazy(() =>
  import('./components/HostToolkit').then((module) => ({ default: module.HostToolkit })),
);

type Page = 'welcome' | 'gateway' | 'library' | 'room' | 'host-tools';
export default function App() {
  const [page, setPage] = useState<Page>('welcome');
  const [rule, setRule] = useState<RuleId>('dnd');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('interlude-theme') || 'light';
    } catch {
      return 'light';
    }
  });
  const [library, setLibrary] = useState(getLibrary);
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<Session | null>(getSession);
  const sessionRef = useRef(session);
  const [connected, setConnected] = useState(false);
  const [recovering, setRecovering] = useState(!!session);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [editor, setEditor] = useState<{
    rule: RuleId;
    initial?: Character;
    inRoom?: boolean;
  } | null>(null);
  const [rules, setRules] = useState<RuleId | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 6000 : 3500);
  }, []);
  const acceptConnection = useCallback((value: RoomConnection, restoring = false) => {
    sessionRef.current = value.session;
    setSession(value.session);
    writeStored('interlude-session', value.session);
    setRoom(value.room);
    setRule(value.room.rule);
    setPage((current) =>
      restoring && ['host-tools', 'library'].includes(current) ? current : 'room',
    );
    setRecovering(false);
  }, []);
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      if (sessionRef.current)
        void resumeRoom(sessionRef.current)
          .then((value) => acceptConnection(value, true))
          .catch((error) => {
            setRecovering(false);
            const message = (error as Error).message;
            if (/不存在|过期|凭证|重新加入|已离开/.test(message)) {
              sessionRef.current = null;
              setSession(null);
              writeStored('interlude-session', null);
              setRoom(null);
              setPage('welcome');
            }
            notify(message, 'error');
          });
    };
    const onDisconnect = () => setConnected(false);
    const onState = (state: Room) => setRoom(state);
    const onLeft = ({ reason }: { reason: string }) => {
      setRoom(null);
      setSession(null);
      sessionRef.current = null;
      writeStored('interlude-session', null);
      setPage('welcome');
      setEditor(null);
      notify(reason);
    };
    const onError = () => {
      setConnected(false);
      setRecovering(false);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('room:left', onLeft);
    socket.on('connect_error', onError);
    socket.connect();
    void getStatus()
      .then((status) => setAiConfigured(status.aiConfigured))
      .catch(() => {});
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('room:left', onLeft);
      socket.off('connect_error', onError);
      socket.disconnect();
    };
  }, [acceptConnection, notify]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('interlude-theme', theme);
    } catch {}
  }, [theme]);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeRules = useCallback(() => setRules(null), []);
  async function action(value: RoomAction) {
    await act(value);
  }
  async function saveCharacter(card: Character) {
    if (editor?.inRoom) await act({ type: 'character', character: card });
    setLibrary(saveToLibrary(card));
    setEditor(null);
    notify(editor?.inRoom ? '角色卡已提交，请等待主持人审核。' : '角色已保存至档案。');
  }
  const go = (next: Page) => {
    setPage(next);
    setMobileNav(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  };
  const navigation = (
    <>
      <button
        className={`nav-button ${['welcome', 'gateway', 'room'].includes(page) ? 'active' : ''}`}
        onClick={() => go(room ? 'room' : 'welcome')}
      >
        <Armchair size={22} />
        <span>{room ? '我的房间' : '入席'}</span>
      </button>
      <button
        className={`nav-button ${page === 'library' ? 'active' : ''}`}
        onClick={() => go('library')}
      >
        <FileText size={21} />
        <span>角色档案</span>
      </button>
      <button
        className={`nav-button ${page === 'host-tools' ? 'active' : ''}`}
        onClick={() => go('host-tools')}
      >
        <PanelsTopLeft size={21} />
        <span>主持人工具集</span>
      </button>
      <button
        className="nav-button"
        onClick={() => {
          setRules(room?.rule ?? rule);
          setMobileNav(false);
        }}
      >
        <BookOpen size={21} />
        <span>规则速览</span>
      </button>
    </>
  );
  return (
    <div className={`app ${page === 'room' ? 'room-app' : ''}`}>
      <aside className="sidebar">
        <button
          className="sidebar-logo"
          aria-label="幕间首页"
          onClick={() => go(room ? 'room' : 'welcome')}
        >
          <Logo />
        </button>
        <nav>{navigation}</nav>
        <div className="sidebar-bottom">
          <span className="vertical-text">THE STORY IS OURS.</span>
          <button
            className="nav-button"
            onClick={() => setRules(room?.rule ?? rule)}
            aria-label="使用帮助"
          >
            <CircleHelp size={21} />
          </button>
        </div>
      </aside>
      <div className="app-content">
        <header className="app-header">
          <div className="header-context">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileNav((v) => !v)}
              aria-label={mobileNav ? '关闭导航' : '打开导航'}
            >
              {mobileNav ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span className="mobile-logo">
              <Logo />
            </span>
            <span className="desktop-context">
              {page === 'library' || page === 'host-tools'
                ? '我的空间'
                : page === 'room'
                  ? '同桌空间'
                  : '跑团同桌'}
              <span className="context-slash">/</span>
              <span className="muted">
                {page === 'host-tools'
                  ? '主持人工具集'
                  : page === 'library'
                    ? '角色档案'
                    : page === 'room'
                      ? room?.name
                      : page === 'gateway'
                        ? '准备入席'
                        : '选择你的故事'}
              </span>
            </span>
          </div>
          <div className="header-actions">
            {room && page !== 'room' && (
              <button className="text-button" onClick={() => go('room')}>
                <ArrowLeft size={15} /> 返回房间
              </button>
            )}
            <span className="header-caption">让想象，有处安放。</span>
            <ThemeToggle
              theme={theme}
              onToggle={() => setTheme((v) => (v === 'light' ? 'dark' : 'light'))}
            />
          </div>
        </header>
        {mobileNav && <nav className="mobile-navigation">{navigation}</nav>}
        <main className={page === 'room' ? 'room-main' : 'main-content'}>
          {recovering && <div className="connection-banner">正在找回你上一次的座位…</div>}
          {!connected && room && (
            <div className="connection-banner warning">
              与房间的连接已断开，正在重连。连接恢复后可继续操作。
            </div>
          )}
          {page === 'welcome' && (
            <RuleSelection
              onSelect={(r) => {
                setRule(r);
                setPage('gateway');
              }}
              onRules={setRules}
              onLibrary={() => go('library')}
            />
          )}
          {page === 'gateway' && (
            <Gateway
              key={rule}
              rule={rule}
              onBack={() => go('welcome')}
              onCreate={async (input: CreateRoomInput) => {
                acceptConnection(await createRoom(input));
                notify('房间已创建，把房间码分享给同伴吧。');
              }}
              onJoin={async (input: JoinRoomInput) => {
                acceptConnection(await joinRoom(input));
                notify('已经入席，欢迎来到这段故事。');
              }}
            />
          )}
          {page === 'library' && (
            <Library
              cards={library}
              onCreate={(r) => setEditor({ rule: r })}
              onEdit={(card) => setEditor({ rule: card.rule, initial: card })}
              onImport={(card) => {
                setLibrary(saveToLibrary(card));
                notify(`「${card.name}」已导入。`);
              }}
              onDelete={(id) => {
                const next = library.filter((c) => c.id !== id);
                writeStored('interlude-library', next);
                setLibrary(next);
                notify('角色档案已移除。');
              }}
            />
          )}
          {page === 'room' && room && session && (
            <RoomView
              room={room}
              session={session}
              connected={connected}
              aiConfigured={aiConfigured}
              library={library}
              onAction={action}
              onEdit={(card) =>
                setEditor({ rule: room.rule, initial: card ?? undefined, inRoom: true })
              }
              onRules={() => setRules(room.rule)}
              onHostToolkit={() => go('host-tools')}
              notify={notify}
            />
          )}
          {page === 'host-tools' && (
            <Suspense
              fallback={
                <div className="toolkit-loading" role="status">
                  <Spinner />
                  正在打开主持人工具集…
                </div>
              }
            >
              <HostToolkit
                room={room}
                memberId={session?.memberId}
                onAction={action}
                onReturnRoom={() => go('room')}
                notify={notify}
              />
            </Suspense>
          )}
        </main>
      </div>
      {editor && (
        <CharacterEditor
          key={editor.initial?.id ?? editor.rule}
          {...editor}
          policy={editor.inRoom ? room?.creationPolicy : undefined}
          onSave={saveCharacter}
          onClose={closeEditor}
        />
      )}
      {rules && <RulesModal rule={rules} onClose={closeRules} />}
      {toast && <Toast {...toast} />}
    </div>
  );
}
