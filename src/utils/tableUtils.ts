import { supabase } from '@/integrations/supabase/client';

export const inputUtils = {
  parseNumericInput: (value: string): number | undefined => {
    if (!value) return undefined;
    const normalized = value.replace(',', '.');
    const num = parseFloat(normalized);
    return isNaN(num) ? undefined : num;
  },
  
  formatNumericOutput: (value: number | undefined): string => {
    if (value === undefined || value === null) return '';
    return value.toString();
  }
};

export const tableApi = {
  async fetchTableData(tableId: string) {
    try {
      const { data, error } = await supabase
        .from('poker_tables')
        .select('*')
        .eq('id', tableId)
        .single();
      
      if (error) throw error;
      return data;
    } catch (e) {
      console.error('[TableAPI] fetchTableData failed:', e);
      throw e;
    }
  },

  async updateEndUpValue(tableId: string, playerId: string, value: number) {
    try {
      const { error } = await supabase
        .from('end_ups')
        .upsert({
          table_id: tableId,
          player_id: playerId,
          value,
          updated_at: new Date().toISOString()
        }, { onConflict: 'table_id,player_id' });
      
      if (error) throw error;
    } catch (e) {
      console.error('[TableAPI] updateEndUpValue failed:', e);
      throw e;
    }
  }
};

export const errorUtils = {
  isAccessControlOrTransient: (err: any): boolean => {
    if (!err) return false;
    const msg = (err?.message || '').toString().toLowerCase();
    return (
      msg.includes('access control') ||
      msg.includes('permission') ||
      msg.includes('forbidden') ||
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('cors') ||
      err instanceof TypeError
    );
  }
};
