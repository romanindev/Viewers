const requireEnv = (key: string, fallback: string): string => {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
};

export const VIEWER_ORIGIN = requireEnv('VITE_VIEWER_ORIGIN', 'http://localhost:3000');

export const VIEWER_STUDY_URL = requireEnv(
  'VITE_VIEWER_STUDY_URL',
  'http://localhost:3000/viewer?StudyInstanceUIDs=1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5'
);

export const HOST_ORIGIN = requireEnv('VITE_HOST_ORIGIN', 'http://localhost:5173');