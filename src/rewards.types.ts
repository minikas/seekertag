export type RewardConfig = {
  enabled: boolean;
  available?: boolean;
  cluster: 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';
  assetLabel: string;
  mint: string;
  programId: string;
  reason?: string;
};
export type Reward = {
  id: string;
  status: 'draft' | 'funded' | 'committed' | 'expired' | 'paid' | 'refunded' | 'unavailable';
  amount: string;
  assetLabel: string;
  cluster: RewardConfig['cluster'];
  wallet: string;
  expiresAt: string;
  address: string;
  explorerUrl: string | null;
  recipientWallet?: string;
  reportRef?: string;
  claimSeq: string;
  committedAt?: string | null;
  transactionSignature?: string;
};
export type RewardResult = { reward: Reward | null; recipient?: { wallet: string; verifiedAt: string; reportRef: string } | null; canResolve?: boolean; commitmentMatchesReport?: boolean };
export type RewardAction = 'fund' | 'renew' | 'commit' | 'release' | 'waive' | 'refund';
export type PreparedReward = {
  reward: Reward;
  transaction: string;
  wallet: string;
  action: RewardAction;
  lastValidBlockHeight: number;
  intent: {
    id: string;
    rewardId: string;
    mint: string;
    programId: string;
    amountBaseUnits: string;
    expiresAt: string;
    claimSeq: string;
    recipientWallet?: string;
    reportRef?: string;
  };
};
