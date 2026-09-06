export type LabelDownload = { url: string; token: string; fileName?: string };

export const labelFileName = (name = 'SeekerTag-etiqueta.pdf') => {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100);
  return sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;
};
