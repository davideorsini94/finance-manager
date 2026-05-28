import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LogOut, Settings as SettingsIcon, User as UserIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/useAuth';

const itemCls =
  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground';

function initials(name?: string | null, email?: string) {
  const src = (name && name.trim()) || email || '?';
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

export function UserMenu() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const go = (to: '/login' | '/settings') => {
    setOpen(false);
    void navigate({ to });
  };

  const onLogout = async () => {
    setOpen(false);
    await logout();
    await navigate({ to: '/login' });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="User menu" className="rounded-full">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-semibold">
            {initials(user?.fullName, user?.email)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="z-50 w-56 p-1.5">
        <div className="px-2 py-1.5">
          <div className="truncate text-sm font-medium">{user?.fullName ?? user?.email}</div>
          {user?.fullName && (
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          )}
        </div>
        <div className="my-1 h-px bg-border" />
        <button type="button" className={itemCls} onClick={() => go('/settings')}>
          <UserIcon className="h-4 w-4" />
          <span>Profilo</span>
        </button>
        <button type="button" className={itemCls} onClick={() => go('/settings')}>
          <SettingsIcon className="h-4 w-4" />
          <span>{t('nav.settings')}</span>
        </button>
        <div className="my-1 h-px bg-border" />
        <button type="button" className={itemCls} onClick={onLogout}>
          <LogOut className="h-4 w-4" />
          <span>{t('nav.logout')}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
