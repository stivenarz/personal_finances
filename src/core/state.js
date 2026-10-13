/**
 * Estado de UI compartido (no se persiste en la nube).
 */
import { currentMonthStr } from './utils.js';

export const uiState = {
    currentMonth: currentMonthStr()
};
