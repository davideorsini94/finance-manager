import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/store/uiStore';

export function PrivacyToggle() {
  const { t } = useTranslation();
  const privacy = useUIStore((s) => s.privacy);
  const togglePrivacy = useUIStore((s) => s.togglePrivacy);

  return (
    <button
      type="button"
      aria-label={privacy ? t('common.privacy.show') : t('common.privacy.hide')}
      aria-pressed={privacy}
      onClick={togglePrivacy}
      className="fm-glass-press grid h-9 w-9 place-items-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {privacy ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
    </button>
  );
}
