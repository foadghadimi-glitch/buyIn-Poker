export type Role = 'admin' | 'player';

export type Player = {
  id: string;
  name: string;
  avatar?: string | null; // data URL or external URL
  totalBuyIns: number;
  finalAmount?: number | null;
};

export type BuyInRequestStatus = 'pending' | 'approved' | 'rejected';

export type BuyInRequest = {
  id: string;
  playerId: string;
  amount: number;
  status: BuyInRequestStatus;
};

export type TableStatus = 'active' | 'ended';

export type Table = {
  id: string;
  name?: string;
  joinCode: string; // 6 digits
  adminId: string; // Player.id
  players: Player[];
  requests: BuyInRequest[];
  status: TableStatus;
};

export type Profile = {
  id: string; // generated locally for now
  name: string;
  avatar?: string | null;
};
