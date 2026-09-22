/** Actual .riv authoring over the community Rive MCP; deterministic official-runtime frame export. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { RiveHost } from "rive-mcp-server/dist/riveHost.js";
import { PAGE_SCRIPT } from "rive-mcp-server/dist/pageScript.js";
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const qa = path.resolve("../qa/promo-rive");
fs.mkdirSync(qa, { recursive: true });
const chromium = process.env.RIVE_MCP_CHROME;
if (!chromium) throw Error("Set RIVE_MCP_CHROME to your Chromium executable.");
const client = new Client({ name: "seekertag-promo", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("node_modules/rive-mcp-server/dist/index.js")],
    cwd: root,
    env: { ...process.env },
  }),
);
async function call(name, args, label) {
  const r = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  let n = 0;
  for (const c of r.content ?? []) {
    if (c.type === "text") {
      fs.writeFileSync(path.join(qa, `${label}.txt`), c.text);
      console.log(name, c.text.slice(0, 250));
    } else if (c.type === "image")
      fs.writeFileSync(
        path.join(qa, `${label}-${n++}.png`),
        Buffer.from(c.data, "base64"),
      );
  }
  if (r.isError) throw Error(name + " failed");
  return r;
}
const qr = JSON.parse(fs.readFileSync("rive/qr.json"));
const tok = JSON.parse(fs.readFileSync("rive/tokens.json"));
// Existing user-approved brand wins over generated token palette. Timing/easing use MCP tokens.
const C = {
  paper: "#EAF2EC",
  ink: "#0D1615",
  cyan: "#00BDCD",
  white: "#F5FAF8",
  muted: tok.palette.textMuted,
  outline: tok.palette.outline,
};
const rect = (id, x, y, w, h, fill, parent, z = 10, r = 0) => ({
  id,
  type: "rect",
  x,
  y,
  width: w,
  height: h,
  cornerRadius: r,
  fill: { color: fill },
  parent,
  z,
});
const ellipse = (id, x, y, w, h, fill, parent, z = 10) => ({
  ...rect(id, x, y, w, h, fill, parent, z),
  type: "ellipse",
});
const line = (id, points, color, width, parent, z = 10) => ({
  id,
  type: "polygon",
  x: 0,
  y: 0,
  closed: false,
  points: points.map(([x, y]) => ({ x, y })),
  stroke: { color, thickness: width, cap: "round", join: "round" },
  parent,
  z,
});
function text(
  id,
  value,
  x,
  y,
  size,
  color,
  parent,
  width = 400,
  align = "center",
  z = 100,
) {
  return {
    id,
    x,
    y,
    width,
    align,
    parent,
    z,
    runs: [{ text: value, fontSize: size, font: "arimo", color }],
  };
}
function track(target, property, keys) {
  return {
    target,
    property,
    keyframes: keys.map(([frame, value, easing]) => ({
      frame,
      value,
      easing: easing ?? "smooth",
    })),
  };
}
function qrShapes(prefix, parent, x, y, size, z) {
  const out = [];
  const unit = size / (qr.size + 8);
  out.push(rect(prefix + "paper", x, y, size, size, "#FFFFFF", parent, z));
  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++)
      if (qr.matrix[r * qr.size + c])
        out.push(
          rect(
            `${prefix}${r}_${c}`,
            x - size / 2 + (c + 4.5) * unit,
            y - size / 2 + (r + 4.5) * unit,
            unit + 0.015,
            unit + 0.015,
            C.ink,
            parent,
            z + 1,
          ),
        );
  return out;
}
function tag(prefix, parent, z = 10) {
  return [
    line(
      prefix + "cord",
      [
        [380, 1092],
        [382, 1147],
        [413, 1170],
      ],
      C.ink,
      5,
      parent,
      z,
    ),
    {
      ...rect(prefix + "shadow", 420, 1275, 194, 239, C.ink, parent, z, 17),
      rotation: 7,
      opacity: 0.26,
    },
    {
      ...rect(prefix + "card", 412, 1256, 186, 230, C.white, parent, z + 1, 15),
      rotation: 7,
    },
    ...qrShapes(prefix + "qr", prefix + "tag-rotation", 0, 8, 159, z + 2),
    ellipse(prefix + "hole", 401, 1166, 13, 13, C.ink, parent, z + 3),
  ];
}
const scan = {
  artboard: { name: "BagToScan", width: 1080, height: 1920 },
  fonts: [{ id: "arimo", path: "assets/Arimo.ttf" }],
  groups: [
    { id: "world", x: 0, y: 0 },
    { id: "bag-tag-rotation", x: 410, y: 1251, rotation: 7, parent: "world" },
    { id: "phone", x: 540, y: 1050 },
    {
      id: "camera",
      x: -328,
      y: -1000,
      parent: "phone",
      scaleX: 0.8,
      scaleY: 0.8,
      clipBy: "screen-mask",
    },
    {
      id: "camera-tag-rotation",
      x: 410,
      y: 1251,
      rotation: 7,
      parent: "camera",
    },
    { id: "success", x: 0, y: 275, parent: "phone" },
  ],
  images: [
    {
      id: "photo",
      pngPath: "assets/backpack-cafe.png",
      x: 540,
      y: 960,
      scale: 1080 / 941,
      parent: "world",
      z: 0,
    },
    {
      id: "camera-photo",
      pngPath: "assets/backpack-cafe.png",
      x: 540,
      y: 960,
      scale: 1080 / 941,
      parent: "camera",
      z: 120,
    },
  ],
  shapes: [
    ...tag("bag-", "world", 10),
    {
      ...rect("phone-shadow", 12, 22, 414, 856, C.ink, "phone", 90, 48),
      opacity: 0.23,
    },
    rect("phone-body", 0, 0, 406, 852, C.ink, "phone", 100, 43),
    {
      ...rect("phone-rim", 0, 0, 398, 844, C.ink, "phone", 101, 40),
      stroke: { color: C.outline, thickness: 3 },
    },
    rect("screen-under", 0, 0, 378, 814, "#344844", "phone", 110, 31),
    {
      id: "screen-mask",
      type: "rect",
      x: 0,
      y: 0,
      width: 378,
      height: 814,
      cornerRadius: 31,
      parent: "phone",
      z: 111,
    },
    ...tag("camera-", "camera", 130),
    rect("camera-top", 0, -350, 378, 120, C.ink, "phone", 145, 0),
    rect("camera-bottom", 0, 343, 378, 128, C.ink, "phone", 145, 0),
    rect("notch", 0, -388, 82, 12, "#61756E", "phone", 160, 6),
    rect("home-indicator", 0, 387, 112, 5, C.white, "phone", 160, 3),
    line(
      "cornerTL",
      [
        [-126, -105],
        [-126, -139],
        [-92, -139],
      ],
      C.cyan,
      6,
      "phone",
      170,
    ),
    line(
      "cornerTR",
      [
        [126, -105],
        [126, -139],
        [92, -139],
      ],
      C.cyan,
      6,
      "phone",
      170,
    ),
    line(
      "cornerBL",
      [
        [-126, 110],
        [-126, 144],
        [-92, 144],
      ],
      C.cyan,
      6,
      "phone",
      170,
    ),
    line(
      "cornerBR",
      [
        [126, 110],
        [126, 144],
        [92, 144],
      ],
      C.cyan,
      6,
      "phone",
      170,
    ),
    {
      ...rect("scan-line", 0, -130, 242, 5, C.cyan, "phone", 171, 2),
      opacity: 0,
    },
    rect("success-pill", 0, 0, 294, 66, C.cyan, "success", 180, 22),
  ],
  texts: [
    text(
      "scan-caption",
      "SCAN TAG",
      -185,
      -341,
      22,
      C.white,
      "phone",
      370,
      "center",
      190,
    ),
    text(
      "success-text",
      "BACKPACK FOUND",
      -145,
      -17,
      21,
      C.ink,
      "success",
      290,
      "center",
      190,
    ),
  ],
  animations: [
    {
      name: "scan",
      duration: 162,
      fps: 30,
      loop: "oneShot",
      tracks: [
        track("phone", "x", [
          [0, 1400, "hold"],
          [69, 1400, "hold"],
          [92, 788, "emphasized-decel"],
          [144, 788, "hold"],
          [162, 540, "emphasized-decel"],
        ]),
        track("phone", "y", [
          [0, 1200, "hold"],
          [69, 1200, "hold"],
          [92, 1090, "ease-out-back"],
          [144, 1090, "hold"],
          [162, 1050, "emphasized-decel"],
        ]),
        track("phone", "rotation", [
          [0, 17, "hold"],
          [69, 17, "hold"],
          [96, -6, "emphasized-decel"],
          [144, -6, "hold"],
          [162, 0, "emphasized-decel"],
        ]),
        track("phone", "scaleX", [
          [0, 1, "hold"],
          [144, 1, "hold"],
          [162, 1.25, "emphasized-decel"],
        ]),
        track("phone", "scaleY", [
          [0, 1, "hold"],
          [144, 1, "hold"],
          [162, 1.25, "emphasized-decel"],
        ]),
        track("scan-line", "opacity", [
          [0, 0, "hold"],
          [96, 0, "hold"],
          [99, 1, "ease-out"],
          [124, 1, "hold"],
          [128, 0, "ease-out"],
        ]),
        track("scan-line", "y", [
          [0, -130, "hold"],
          [96, -130, "hold"],
          [124, 135, "smooth"],
        ]),
        track("success", "opacity", [
          [0, 0, "hold"],
          [127, 0, "hold"],
          [132, 1, "ease-out"],
        ]),
        track("success", "scaleX", [
          [0, 0.8, "hold"],
          [127, 0.8, "hold"],
          [139, 1, "ease-out-back"],
        ]),
        track("success", "scaleY", [
          [0, 0.8, "hold"],
          [127, 0.8, "hold"],
          [139, 1, "ease-out-back"],
        ]),
      ],
    },
  ],
};
const reward = {
  artboard: { name: "FinderReward", width: 1080, height: 1920 },
  fonts: [{ id: "arimo", path: "assets/Arimo.ttf" }],
  groups: [
    { id: "wallet", x: 268, y: 1268 },
    { id: "received", x: 265, y: 1470 },
  ],
  shapes: [
    rect("background", 540, 960, 1080, 1920, C.paper, undefined, 0),
    {
      ...ellipse("wallet-shadow", 268, 1395, 324, 36, C.ink, undefined, 5),
      opacity: 0.1,
    },
    rect("wallet-back", 0, -8, 300, 218, C.cyan, "wallet", 10, 32),
    rect("wallet-inside", 0, -13, 275, 184, C.ink, "wallet", 11, 22),
    rect("wallet-front", 0, 40, 300, 158, C.ink, "wallet", 100, 27),
    {
      ...rect("wallet-edge", 0, 43, 288, 144, C.ink, "wallet", 101, 23),
      stroke: { color: "#61756E", thickness: 3 },
    },
    rect("wallet-clasp", 121, 29, 96, 60, C.cyan, "wallet", 102, 16),
    ellipse("wallet-dot", 108, 29, 13, 13, C.ink, "wallet", 103),
  ],
  texts: [
    text("finder-label", "THE FINDER", 90, 602, 29, C.ink, undefined, 350),
    text("reward-amount", "+0.95 SKR", -205, -25, 72, C.ink, "received", 410),
    text("reward-sub", "REWARD RECEIVED", -200, 63, 25, C.ink, "received", 400),
  ],
  imports: [],
  animations: [
    {
      name: "reward",
      duration: 108,
      fps: 30,
      loop: "oneShot",
      tracks: [],
      presets: [
        { preset: "attention", target: "wallet", at: 44, intensity: 0.55 },
      ],
    },
  ],
};
for (let i = 0; i < 3; i++) {
  const id = "coin" + i;
  reward.groups.push({ id, x: 245, y: 930 });
  reward.shapes.push(
    ellipse(id + "rim", 0, 0, 190, 190, C.cyan, id, 30 + i * 10),
    ellipse(id + "inner", 0, 0, 178, 178, C.ink, id, 31 + i * 10),
  );
  reward.imports.push({
    spec: "rive/skr-shapes.json",
    id: id + "logo",
    parent: id,
    x: -77,
    y: -77,
    scale: 154 / 64,
    z: 32 + i * 10,
  });
  const d = i * 6;
  reward.animations[0].tracks.push(
    track(id, "opacity", [
      [0, 0, "hold"],
      [5 + d, 0, "hold"],
      [9 + d, 1, "ease-out"],
      [44 + d, 1, "hold"],
      [48 + d, 0, "ease-out"],
    ]),
    track(id, "x", [
      [0, 120 + i * 85, "hold"],
      [5 + d, 120 + i * 85, "hold"],
      [23 + d, 335 - i * 35, "ease-out"],
      [48 + d, 268, "ease-in"],
    ]),
    track(id, "y", [
      [0, 970 - i * 25, "hold"],
      [5 + d, 970 - i * 25, "hold"],
      [20 + d, 825 - i * 45, "ease-out"],
      [48 + d, 1255, "ease-in"],
    ]),
    track(id, "rotation", [
      [0, -24, "hold"],
      [48 + d, 30, "ease-in-out"],
    ]),
    track(id, "scaleX", [
      [0, 0.75, "hold"],
      [20 + d, 1, "ease-out"],
      [48 + d, 0.5, "ease-in"],
    ]),
    track(id, "scaleY", [
      [0, 0.75, "hold"],
      [20 + d, 1, "ease-out"],
      [48 + d, 0.5, "ease-in"],
    ]),
  );
}
reward.animations[0].tracks.push(
  track("received", "opacity", [
    [0, 0, "hold"],
    [53, 0, "hold"],
    [62, 1, "ease-out"],
  ]),
  track("received", "y", [
    [0, 1495, "hold"],
    [53, 1495, "hold"],
    [67, 1470, "ease-out-back"],
  ]),
);
const jobs = [
  ["bag-scan", scan, 4.3],
  ["finder-reward", reward, 2.5],
].filter(
  ([name]) =>
    !process.argv.includes("--only-reward") || name === "finder-reward",
);
try {
  for (const [name, scene, time] of jobs) {
    fs.writeFileSync(
      `rive/${name}.scene.json`,
      JSON.stringify(scene, null, 2) + "\n",
    );
    await call(
      "riv_create",
      { outPath: `rive/${name}.riv`, scene, previewTime: time },
      name + "-preview",
    );
    await call("riv_lint", { path: `rive/${name}.riv` }, name + "-lint");
    await call(
      "riv_critique",
      { path: `rive/${name}.riv`, frames: 8, width: 270 },
      name + "-critique",
    );
  }
} finally {
  await client.close();
}
if (process.argv.includes("--render")) {
  const host = new RiveHost(PAGE_SCRIPT);
  try {
    for (const [name, scene] of jobs) {
      const anim = scene.animations[0];
      const dir = path.join(qa, name + "-frames");
      fs.mkdirSync(dir, { recursive: true });
      const bytes = fs.readFileSync(`rive/${name}.riv`);
      for (let start = 0; start < anim.duration; start += 12) {
        const r = await host.renderFrames(bytes, {
          animation: anim.name,
          startTime: start / 30,
          frameCount: Math.min(12, anim.duration - start),
          fps: 30,
          width: 1080,
          height: 1920,
          format: "png",
        });
        for (let i = 0; i < r.frames.length; i++)
          fs.writeFileSync(
            path.join(dir, `${String(start + i).padStart(4, "0")}.png`),
            Buffer.from(r.frames[i], "base64"),
          );
        console.log(name, start + "/" + anim.duration);
      }
      const out = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-framerate",
          "30",
          "-i",
          path.join(dir, "%04d.png"),
          "-c:v",
          "libx264",
          "-crf",
          "15",
          "-preset",
          "medium",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-y",
          `assets/${name}.mp4`,
        ],
        { stdio: "inherit" },
      );
      if (out.status) throw Error("FFmpeg failed");
    }
  } finally {
    await host.close();
  }
}
