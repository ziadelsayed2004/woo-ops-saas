export type DocumentFormat = 'a4' | 'a5' | 'thermal-80mm' | 'label-100x150mm';
export type DocumentSnapshot = {
  orderId: string;
  format: DocumentFormat;
  templateVersion: number;
  checksum?: string;
};
