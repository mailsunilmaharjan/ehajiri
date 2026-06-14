import { useSettings } from '../context/SettingsContext.jsx';
import { makeDateFormatter } from '../utils/dateUtils.js';

/**
 * Returns a pre-bound fd(dateString) formatter that reads
 * calendar / format / nepaliDigits from global settings.
 *
 * Usage:
 *   const fd = useDateFormat();
 *   fd('2026-05-27')  →  '२७-जेठ-२०८३'  (depending on settings)
 */
const useDateFormat = () => {
  const { settings } = useSettings();
  return makeDateFormatter(settings);
};

export default useDateFormat;
