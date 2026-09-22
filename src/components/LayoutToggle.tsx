import { Grid2X2, List } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import type { DetailLayout } from '../../shared/page-images';
export function LayoutToggle({
  layout,
  onChange,
}: {
  layout: DetailLayout;
  onChange: (layout: DetailLayout) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      className="layout-toggle"
      role="switch"
      aria-label={t('library.listView')}
      aria-checked={layout === 'list'}
      title={t(layout === 'grid' ? 'library.switchList' : 'library.switchGrid')}
      onClick={() => onChange(layout === 'grid' ? 'list' : 'grid')}
    >
      <span className="layout-toggle-thumb" aria-hidden="true" />
      <Grid2X2 size={15} aria-hidden="true" />
      <List size={16} aria-hidden="true" />
    </button>
  );
}
