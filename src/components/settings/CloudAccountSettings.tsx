import React, { useState } from 'react';
import { CheckCircle2, Cloud, CloudOff, KeyRound, LoaderCircle, LogOut, UserPlus } from 'lucide-react';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

function describeSync(status: ReturnType<typeof useData>['cloudSync']): string {
  if (status === 'SYNCED') return '所有修改已保存';
  if (status === 'LOADING') return '正在保存最新修改';
  if (status === 'ERROR') return '云端保存遇到问题';
  return '当前只保存在这台设备';
}

export function CloudAccountSettings() {
  const { cloudEnabled, status, user, error, signIn, register, signOut } = useAuth();
  const { cloudSync, cloudSyncError } = useData();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setLocalError('请填写账号和密码');
      return;
    }
    if (mode === 'REGISTER') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(cleanUsername)) {
        setLocalError('账号需以字母或数字开头，只能使用字母、数字、点、下划线和短横线');
        return;
      }
      const passwordKinds = [
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /[0-9]/.test(password),
        /[()!@#$%^&*|?><_-]/.test(password),
      ].filter(Boolean).length;
      if (password.length < 8 || password.length > 32 || !/^[A-Za-z0-9]/.test(password) || passwordKinds < 3) {
        setLocalError('密码需为 8–32 位、以字母或数字开头，并包含至少三类字符');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('两次输入的密码不一致');
        return;
      }
      if (!inviteCode.trim()) {
        setLocalError('请输入邀请码');
        return;
      }
    }
    setBusy(true);
    setLocalError(null);
    try {
      if (mode === 'REGISTER') {
        await register(cleanUsername, password, inviteCode);
      } else {
        await signIn(cleanUsername, password);
      }
      setPassword('');
      setConfirmPassword('');
      setInviteCode('');
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await signOut();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!cloudEnabled) {
    return (
      <Card title="保存与账号" bodyClassName="p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card-hover text-secondary">
            <CloudOff size={18} />
          </span>
          <div>
            <p className="text-[13px] font-medium text-primary">本机保存</p>
            <p className="mt-1 text-[12px] leading-5 text-secondary">
              当前版本没有连接云端。记录会留在这台设备，可在下方随时导出备份。
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (status === 'SIGNED_IN' && user) {
    return (
      <Card title="保存与账号" bodyClassName="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-healthy/10 text-healthy">
            {cloudSync === 'LOADING' ? <LoaderCircle size={18} className="animate-spin" /> : <Cloud size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[13px] font-medium text-primary">
                {user.username ?? user.email ?? 'CloudBase 用户'}
              </p>
              {cloudSync === 'SYNCED' && <CheckCircle2 size={14} className="text-healthy" />}
            </div>
            <p className={`mt-1 text-[12px] ${cloudSync === 'ERROR' ? 'text-danger' : 'text-secondary'}`}>
              {cloudSyncError ?? describeSync(cloudSync)}
            </p>
          </div>
        </div>
        <div className="flex justify-end border-t border-line-soft pt-3">
          <Button variant="outline" onClick={() => void leave()} disabled={busy}>
            <LogOut size={15} /> 退出账号
          </Button>
        </div>
        {localError && <p role="alert" className="text-[12px] text-danger">{localError}</p>}
      </Card>
    );
  }

  return (
    <Card
      title="登录后自动备份"
      subtitle="同一账号可在手机和电脑继续使用"
      bodyClassName="p-4"
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 rounded-lg bg-card-hover p-1" aria-label="账号操作">
          <button
            type="button"
            onClick={() => { setMode('LOGIN'); setLocalError(null); }}
            className={`min-h-10 rounded-md text-[13px] font-medium transition-colors ${
              mode === 'LOGIN' ? 'bg-card text-primary shadow-sm' : 'text-secondary'
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => { setMode('REGISTER'); setLocalError(null); }}
            className={`min-h-10 rounded-md text-[13px] font-medium transition-colors ${
              mode === 'REGISTER' ? 'bg-card text-primary shadow-sm' : 'text-secondary'
            }`}
          >
            注册
          </button>
        </div>
        <Input
          label="账号"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={mode === 'REGISTER' ? '设置一个账号' : '输入账号'}
          autoComplete="username"
        />
        <Input
          label="密码"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={mode === 'REGISTER' ? '8–32 位，至少三类字符' : undefined}
          autoComplete={mode === 'REGISTER' ? 'new-password' : 'current-password'}
        />
        {mode === 'REGISTER' && (
          <>
            <Input
              label="确认密码"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
            <Input
              label="邀请码"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="向管理员获取"
              autoComplete="off"
            />
          </>
        )}
        {(localError || error) && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {localError ?? error}
          </p>
        )}
        <Button type="submit" variant="gold" full disabled={busy || status === 'CHECKING'}>
          {busy || status === 'CHECKING' ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : mode === 'REGISTER' ? <UserPlus size={16} /> : <Cloud size={16} />}
          {mode === 'REGISTER' ? '注册并开始使用' : '登录并同步'}
        </Button>
        <p className="text-[11px] leading-5 text-disabled">
          {mode === 'REGISTER' ? (
            <><KeyRound size={12} className="mr-1 inline" />邀请码由管理员提供，每个账号的账本彼此隔离。</>
          ) : '退出后，本设备不再显示该账号的账本；云端记录不会被删除。'}
        </p>
      </form>
    </Card>
  );
}
