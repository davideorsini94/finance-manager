import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/store/uiStore';

export function PrivacyToggle() {
  const { t } = useTranslation();
  const privacy = useUIStore((s) => s.privacy);
  const togglePrivacy = useUIStore((s) => s.togglePrivacy);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={privacy ? t('common.privacy.show') : t('common.privacy.hide')}
      onClick={togglePrivacy}
    >
      {privacy ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}
