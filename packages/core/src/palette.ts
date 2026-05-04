// Exact 222-color CryptoPunks palette mirrored from SVGRenderer.sol PALETTE_RGBA.
// Each entry is 4 bytes (RGBA). Index 0 is fully transparent.
// Mirrored verbatim from slonks-web/src/lib/slonks/palette.ts — keep both in sync.

export const PALETTE_SIZE = 222;
export const SLONK_SIZE = 24;
export const SLONK_PIXELS = SLONK_SIZE * SLONK_SIZE;

const PALETTE_HEX =
  "00000000000000ffae8b61ffdbb180ff713f1dffead9d9fffff68effa66e2cffe22626ff555555ff8119b7ffffffffff28b143ff710cc7ff1a43c8ff51360cff3d2f1eff1637a4ff794b11ff4c4c4cff229000ffca4e11fff0f0f0ff7da269ff933709ff26314affc9c9c9ff86581effb4b4b4ffff8ebeff80dbdaffdddddd804f2c14ff997c59ff562600ffe65700ff515151ffc6c6c6ff796144ff68461fff1a6ed5ff690c45ff8c0d5bffad2160ff005580ff855114ffb9b9b980d29d60ffa77c47ff723709ff353535ff311b0dff2d6b62ff5e4c37ffffd926ff4b3c2aff711010ffa58d8dff5c390fffc77514ffc42110ff8d8d8dffcd00cbffd4c8b8ff328dfdfffd3232ff988880ff5f1d09ff502f05ff2858b1ff2c5195ff2c9541ffbbb3a6ff4a1201ff281b09ff142c7cff1c1a00ff534c00ff595959ffa39797ff856f56ffdc1d1dffe7cba9ffb69f82ff8b532cff596570ffc9b2b2ffe25b26ff683c08ff2a2a2aff85561effd60000ff692f08ffc8fbfbffe4eb17ff293e64ff296434ff655e5effb261dcffb6a389ff352410ff0060c3ff897a70ffa49681ff636363ffd7d7d7ffb1b1b1ffc28946ffffba00ffffc926ff584733ffdfdfdfffd60404ff5e7253ff463827ffdcdfeaff506a65ffa32375ffcfbda6ff2d190cff507c33ff5c8539ff998475ff577149ff3c6827ffb7ab98ffaf2c7bff5c736bff3cc300ff8f0f69ff0040ffff3c5659ffffd800ff5d7975ff3c2413ffb03285ff645849ff4f4538ff765f43ff52321aff917656ff5d8b43ff6e984dffb6b4bfff826849ff486f2bffc13f8fff6e867fff9b166dff485d5dffa48560ff5e5757ff6f6f6fffff0000ff5c915fffb66f4effaf38a1ffda8e66ff5c7f91ff552f16ff853217ffcac9d4ffad7e59ffd09c6eff9b6f4dff825032ff763b1affeeeab6ffaa7b54ff9a8e8bff6e6e6eff6a563fffff2a00ff6aa06effbd47b0ff5d5d5dff999999ff36462dff6a8ea0ff9be0e0ffeeeeeeffb38e7dff9bbc88ff9fc0abffa98c6bffafa3a3ff8ea59fff83c790ffe08282ffdcd8a4ffe6aeaeffdacdbbff75bdbdff65523cff42503affa4a3a0ffe8efc0ff52422fff32412aff392312ffe86570ff868377ffcad6e1ffe8f4ffff8f8254ff43513bff949593ffddbebaffdcdcdcff5b4933ff7f4d36ff382d1fff596d48ffb8b4acff725d43ff251409ff5d2310ff3b210fff473929ffbaaca2ff6b6361ffb0a39bff";

export const PALETTE_RGBA: Uint8Array = (() => {
  if (PALETTE_HEX.length !== PALETTE_SIZE * 4 * 2) {
    throw new Error(
      `palette length mismatch: expected ${PALETTE_SIZE * 4 * 2} hex chars, got ${PALETTE_HEX.length}`,
    );
  }
  const out = new Uint8Array(PALETTE_SIZE * 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(PALETTE_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
})();
