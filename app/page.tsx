'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Save,
  Copy,
  Check,
  Trash2,
  Eye,
  Code2,
  RefreshCw,
  Loader2,
  History,
  AlertCircle,
  LogOut,
  LogIn,
  Download,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import type { ProjectSummary } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import AuthScreen from '@/components/AuthScreen';
import CodeView from '@/components/CodeView';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PLACEHOLDER_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center;
           font-family: system-ui, sans-serif; color: #64748b; background: #f8fafc; }
  </style>
</head>
<body>
  <div style="text-align:center">
    <div style="font-size:28px;margin-bottom:8px">⚡</div>
    <p>输入一句描述，点击「生成」，你的应用会出现在这里。</p>
  </div>
</body>
</html>`;

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s;
}

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [code, setCode] = useState(PLACEHOLDER_HTML);
  const [streamingCode, setStreamingCode] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const pendingActionRef = useRef<null | 'generate' | 'save'>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [exported, setExported] = useState(false);
  const [dirty, setDirty] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const authed = !!session;

  // --- Auth: listen to session changes ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Load projects when session becomes available ---
  useEffect(() => {
    if (!authed) {
      setProjects([]);
      setLoadingProjects(false);
      return;
    }
    let cancelled = false;
    setLoadingProjects(true);
    (async () => {
      const { data: rows, error: queryError } = await supabase
        .from('projects')
        .select('id, title, prompt, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
      if (cancelled) return;
      if (queryError) setError(`加载历史失败：${queryError.message}`);
      else setProjects((rows as ProjectSummary[]) ?? []);
      if (!cancelled) setLoadingProjects(false);
    })();
    return () => { cancelled = true; };
  }, [authed]);

  const reloadProjects = useCallback(async () => {
    if (!authed) return;
    const { data, error: queryError } = await supabase
      .from('projects')
      .select('id, title, prompt, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    if (queryError) {
      setError(`加载历史失败：${queryError.message}`);
      return;
    }
    setProjects((data as ProjectSummary[]) ?? []);
  }, [authed]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProjects([]);
    setPrompt('');
    setCode(PLACEHOLDER_HTML);
    setStreamingCode('');
    setSaved(false);
    setCurrentProjectId(null);
    setDirty(false);
  }, []);

  // --- Streaming generation (core logic, no auth gate) ---
  const runGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setError(null);
    setSaved(false);
    setCurrentProjectId(null);
    setStreamingCode('');
    setTab('code');

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const res = await fetch(`${supabaseUrl}/functions/v1/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ prompt: trimmed }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = `生成失败（HTTP ${res.status}）`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
          if (j?.detail) msg += `：${j.detail}`;
        } catch {}
        throw new Error(msg);
      }

      const json = await res.json();
      const text: string = json?.code ?? '';

      if (!text.trim()) {
        throw new Error('模型返回了空内容，请检查模型名称或余额。');
      }

      setStreamingCode(text);
      setCode(text);
      setDirty(false);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(`生成出错：${(e as Error).message}`);
    } finally {
      setIsStreaming(false);
    }
  }, [prompt, isStreaming]);

  // --- Generate wrapper with auth gate ---
  const generate = useCallback(() => {
    if (!authed) {
      pendingActionRef.current = 'generate';
      setAuthOpen(true);
      return;
    }
    void runGenerate();
  }, [authed, runGenerate]);

  // --- Save ---
  const doSave = useCallback(async () => {
    if (!code || code === PLACEHOLDER_HTML) {
      setError('没有可保存的代码，请先生成。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const title = truncate(prompt.trim() || '未命名应用', 20);
      const { data, error: insertError } = await supabase
        .from('projects')
        .insert({ title, prompt: prompt.trim(), code })
        .select('id')
        .single();
      if (insertError) throw insertError;
      setSaved(true);
      setCurrentProjectId(data?.id ?? null);
      setDirty(false);
      await reloadProjects();
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [code, prompt, reloadProjects]);

  const save = useCallback(() => {
    if (!authed) {
      pendingActionRef.current = 'save';
      setAuthOpen(true);
      return;
    }
    void doSave();
  }, [authed, doSave]);

  // After login completes (authed flips true), run any pending action.
  useEffect(() => {
    if (!authed || !pendingActionRef.current) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action === 'generate') void runGenerate();
    else if (action === 'save') void doSave();
  }, [authed, runGenerate, doSave]);

  // --- Copy ---
  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动选择代码复制。');
    }
  }, [code]);

  // --- Clear ---
  const clearAll = useCallback(() => {
    setPrompt('');
    setCode(PLACEHOLDER_HTML);
    setStreamingCode('');
    setError(null);
    setSaved(false);
    setCurrentProjectId(null);
    setDirty(false);
    setTab('preview');
  }, []);

  // --- Delete a saved project ---
  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      const { error: delErr } = await supabase.from('projects').delete().eq('id', target.id);
      if (delErr) throw delErr;
      if (currentProjectId === target.id) {
        setCurrentProjectId(null);
        setSaved(false);
      }
      await reloadProjects();
    } catch (e) {
      setError(`删除失败：${(e as Error).message}`);
    }
  }, [deleteTarget, currentProjectId, reloadProjects]);

  const exportCode = useCallback(() => {
    if (!code || code === PLACEHOLDER_HTML) {
      setError('没有可导出的代码，请先生成。');
      return;
    }
    const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = (prompt.trim() || 'app').slice(0, 30).replace(/[^\w\u4e00-\u9fa5-]+/g, '-');
    a.download = `${name || 'app'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 1500);
  }, [code, prompt]);

  // --- Load from history ---
  const openProject = useCallback(async (id: string) => {
    setError(null);
    setSaved(false);
    setCurrentProjectId(id);
    try {
      const { data, error: qErr } = await supabase
        .from('projects')
        .select('prompt, code, title')
        .eq('id', id)
        .maybeSingle();
      if (qErr) throw qErr;
      if (!data) {
        setError('找不到该项目。');
        return;
      }
      setPrompt(data.prompt);
      setCode(data.code);
      setDirty(false);
      setTab('preview');
    } catch (e) {
      setError(`加载项目失败：${(e as Error).message}`);
    }
  }, []);

  // --- Manual edit -> re-preview ---
  const rePreview = useCallback(() => {
    setDirty(false);
    setTab('preview');
  }, []);

  const onCodeEdit = (val: string) => {
    setCode(val);
    setDirty(true);
    setSaved(false);
  };

  const canSave = useMemo(
    () => !!code && code !== PLACEHOLDER_HTML && !isStreaming,
    [code, isStreaming]
  );

  // What the iframe shows: during streaming, the placeholder (no flicker);
  // otherwise the committed code.
  const iframeDoc = isStreaming ? PLACEHOLDER_HTML : code;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-none">
                Atoms Demo
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                一句话生成可运行的应用
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex h-2 w-2 rounded-full',
                  authed ? 'bg-emerald-500' : 'bg-slate-300'
                )}
              />
              {authed ? (session?.user?.email ?? '已登录') : '未登录'}
            </span>
            {authed ? (
              <Button variant="ghost" size="sm" onClick={signOut} className="h-7 gap-1 px-2 text-xs">
                <LogOut className="h-3.5 w-3.5" />
                退出
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAuthOpen(true)}
                className="h-7 gap-1 px-2 text-xs"
              >
                <LogIn className="h-3.5 w-3.5" />
                登录
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[40fr_60fr]">
          {/* LEFT: input + history */}
          <section className="flex flex-col gap-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <label className="mb-2 block text-sm font-medium">
                描述你想要的应用
              </label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例如：做一个打地鼠小游戏，能计分、有开始和重新开始按钮"
                className="min-h-[96px] resize-y"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
                }}
              />
              <div className="mt-3 flex items-center gap-2">
                <Button
                  onClick={generate}
                  disabled={isStreaming || !prompt.trim()}
                >
                  {isStreaming ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      生成中…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      生成
                    </>
                  )}
                </Button>
                <span className="text-xs text-slate-400">
                  ⌘/Ctrl + Enter 快速生成
                </span>
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <History className="h-4 w-4 text-slate-500" />
                  生成历史
                </h2>
                <span className="text-xs text-slate-400">
                  最近 {projects.length} 条
                </span>
              </div>

              {loadingProjects ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : projects.length === 0 ? (
                <div className="rounded-lg border border-dashed py-8 text-center text-sm text-slate-400">
                  还没有保存的项目。生成一个并点击「保存」试试。
                </div>
              ) : (
                <ul className="space-y-2">
                  {projects.map((p) => (
                    <li key={p.id} className="group relative">
                      <button
                        onClick={() => openProject(p.id)}
                        className={cn(
                          'w-full rounded-lg border px-3 py-2.5 pr-9 text-left transition hover:border-slate-400 hover:bg-slate-50',
                          currentProjectId === p.id
                            ? 'border-slate-900 bg-slate-50'
                            : 'border-slate-200'
                        )}
                      >
                        <div className="truncate text-sm font-medium">
                          {p.title || '未命名应用'}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          {p.prompt}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          {new Date(p.created_at).toLocaleString('zh-CN')}
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(p);
                        }}
                        aria-label={`删除 ${p.title || '未命名应用'}`}
                        className="absolute right-2 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* RIGHT: preview / code */}
          <section className="flex flex-col gap-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="text-red-400 hover:text-red-600"
                  aria-label="关闭错误提示"
                >
                  ×
                </button>
              </div>
            )}

            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as 'preview' | 'code')}
              className="rounded-xl border bg-white p-3 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="preview" className="gap-1.5">
                    <Eye className="h-4 w-4" />
                    预览
                  </TabsTrigger>
                  <TabsTrigger value="code" className="gap-1.5">
                    <Code2 className="h-4 w-4" />
                    代码
                  </TabsTrigger>
                </TabsList>
                {isStreaming && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在接收流式内容…
                  </span>
                )}
              </div>

              <TabsContent value="preview" className="mt-3">
                {isStreaming ? (
                  <div className="flex h-[60vh] flex-col items-center justify-center gap-3 rounded-lg bg-slate-50">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-[60%] w-[90%]" />
                    <p className="text-xs text-slate-400">
                      生成完成后将自动刷新预览
                    </p>
                  </div>
                ) : (
                  <iframe
                    ref={iframeRef}
                    title="preview"
                    srcDoc={iframeDoc}
                    sandbox="allow-scripts"
                    className="h-[60vh] w-full rounded-lg border bg-white"
                  />
                )}
              </TabsContent>

              <TabsContent value="code" className="mt-3 h-[60vh]">
                <CodeView
                  code={isStreaming ? streamingCode : code}
                  onChange={onCodeEdit}
                  readOnly={isStreaming}
                />
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 shadow-sm">
              <Button onClick={save} disabled={!canSave || saving || saved}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    保存中…
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    已保存
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    保存
                  </>
                )}
              </Button>

              <Button variant="outline" onClick={copyCode}>
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    复制代码
                  </>
                )}
              </Button>

              <Button variant="outline" onClick={exportCode} disabled={isStreaming || !canSave}>
                {exported ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    已导出
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    导出
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={rePreview}
                disabled={isStreaming || !dirty}
                title={dirty ? '用编辑后的代码刷新预览' : '没有未保存的编辑'}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                重新预览
              </Button>

              <Button
                variant="ghost"
                onClick={clearAll}
                disabled={isStreaming}
                className="text-slate-500 hover:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                清空
              </Button>

              {dirty && (
                <span className="ml-auto flex items-center gap-1 text-xs text-amber-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  有未预览的编辑
                </span>
              )}
            </div>
          </section>
        </div>
      </main>

      <AuthScreen
        open={authOpen}
        onOpenChange={setAuthOpen}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条历史？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{deleteTarget?.title || '未命名应用'}」，删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
