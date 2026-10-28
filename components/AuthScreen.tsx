'use client';

import { useState } from 'react';
import { Sparkles, Loader2, LogIn, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type Mode = 'login' | 'signup';

type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
};

const TEST_EMAIL = 'demo@atoms.dev';
const TEST_PASSWORD = 'AtomsDemo2026!';

export default function AuthScreen({ open, onOpenChange, onSuccess }: Props) {
  const embedded = open === undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = embedded ? internalOpen : !!open;
  const setOpen = (v: boolean) => {
    if (embedded) setInternalOpen(v);
    onOpenChange?.(v);
  };

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useTestAccount = () => {
    setEmail(TEST_EMAIL);
    setPassword(TEST_PASSWORD);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码。');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位。');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signUp({ email: email.trim(), password });
        if (err) throw err;
      }
      setOpen(false);
      onSuccess?.();
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('Invalid login')) setError('邮箱或密码错误。');
      else if (msg.includes('already registered') || msg.includes('already been registered'))
        setError('该邮箱已注册，请直接登录。');
      else if (msg.includes('Email rate')) setError('操作太频繁，请稍后再试。');
      else setError(msg || '操作失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  const body = (
    <>
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => { setMode('login'); setError(null); }}
          className={`rounded-md py-1.5 text-sm font-medium transition ${
            mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          登录
        </button>
        <button
          type="button"
          onClick={() => { setMode('signup'); setError(null); }}
          className={`rounded-md py-1.5 text-sm font-medium transition ${
            mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          注册
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            disabled={loading}
          />
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />处理中…</>
          ) : mode === 'login' ? (
            <><LogIn className="mr-2 h-4 w-4" />登录</>
          ) : (
            <><UserPlus className="mr-2 h-4 w-4" />注册并登录</>
          )}
        </Button>
      </form>

      <button
        type="button"
        onClick={useTestAccount}
        className="mt-4 w-full rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-500 transition hover:bg-slate-100"
      >
        一键填入测试账号：{TEST_EMAIL}
      </button>
    </>
  );

  if (embedded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-semibold">Atoms Demo</h1>
            <p className="text-sm text-slate-500">一句话生成可运行的应用</p>
          </div>
          {body}
        </div>
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            登录后保存
          </DialogTitle>
          <DialogDescription>
            保存需要登录账号。登录后可继续保存当前代码。
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
