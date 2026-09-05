export const initialSelection = () => ({ os: null, arch: null, variant: null, format: null });

export function choose(state, name, value) {
  if (name === 'os') return { os: value, arch: null, variant: value === 'linux' ? 'glibc' : null, format: value === 'macos' ? 'dmg' : null };
  if (name === 'arch') return { ...state, arch: value, ...(state.os === 'macos' ? { variant: null } : { format: null }) };
  return { ...state, [name]: value };
}

export function selectionComplete(state) {
  return Boolean(state.os && state.arch && state.variant && state.format);
}
