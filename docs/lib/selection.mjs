export const initialSelection = () => ({ os: null, arch: null, variant: null, format: null });

export function choose(state, name, value) {
  if (name === 'os') return { os: value, arch: null, variant: value === 'linux' ? 'glibc' : value === 'windows' ? 'desktop' : null, format: value === 'macos' ? 'dmg' : value === 'windows' ? 'zip' : null };
  if (name === 'arch') return { ...state, arch: value, ...(state.os === 'macos' ? { variant: null } : state.os === 'windows' ? { format: 'zip' } : { format: null }) };
  return { ...state, [name]: value };
}

export function selectionComplete(state) {
  return Boolean(state.os && state.arch && state.variant && state.format);
}
