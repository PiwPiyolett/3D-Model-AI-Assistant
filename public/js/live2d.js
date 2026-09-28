/* Live2D rendering + lip-sync + expressions + idle gaze for IceGirl. */
(function () {
  const cfg = window.APP_CONFIG;
  const P = cfg.params;

  const IDLE_GAZE_MS = 1800; // look back at the screen after this much cursor stillness

  const Live2DController = {
    app: null,
    model: null,
    ready: false,

    // Lip-sync state.
    speaking: false,       // procedural mouth (browser TTS, no audio data)
    amplitudeMode: false,  // mouth driven by real audio amplitude (edge TTS)
    _amp: 0,
    mouthTarget: 0,
    mouthValue: 0,
    _t: 0,

    // Expression state (managed by us — the library's own manager is unreliable
    // for this model, so we apply expression parameters ourselves each frame).
    expressions: {},      // name -> [{Id, Value, Blend}]
    exprBaseline: {},     // paramId -> neutral/default value
    exprParamIds: [],     // union of all param ids used by expressions
    activeExprName: null,
    activeExpr: null,
    exprWeight: 0,        // eased 0..1
    exprTarget: 0,

    // Gaze state.
    focusX: 0,
    focusY: 0,
    lastPointerMove: 0,
    thinking: false,

    async init(canvas) {
      this.app = new PIXI.Application({
        view: canvas,
        resizeTo: canvas.parentElement,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });

      const model = await PIXI.live2d.Live2DModel.from(cfg.modelUrl, {
        autoInteract: false,
      });
      this.model = model;
      this.app.stage.addChild(model);

      const parent = canvas.parentElement;
      this.app.renderer.resize(parent.clientWidth, parent.clientHeight);
      this._layout();
      window.addEventListener("resize", () => {
        this.app.renderer.resize(parent.clientWidth, parent.clientHeight);
        this._layout();
      });

      // Disable the library's expression manager to avoid it fighting our own
      // per-frame expression parameters.
      try {
        if (model.internalModel.motionManager.expressionManager) {
          model.internalModel.motionManager.expressionManager.stopAllExpressions();
          model.internalModel.motionManager.expressionManager = null;
        }
      } catch (_) {}

      // Track the pointer; gaze target is decided per-frame in _tick.
      this.focusX = this.app.screen.width / 2;
      this.focusY = this.app.screen.height / 2;
      this.lastPointerMove = performance.now();
      this.app.stage.interactive = true;
      this.app.stage.hitArea = this.app.screen;
      this.app.stage.on("pointermove", (e) => {
        this.focusX = e.data.global.x;
        this.focusY = e.data.global.y;
        this.lastPointerMove = performance.now();
      });

      // Apply our custom parameters right after motions each frame.
      model.internalModel.on("afterMotionUpdate", () => this._writeParams());
      this.app.ticker.add((dt) => this._tick(dt));

      // Preload the expression files we map emotions to.
      await this._loadExpressions();

      this.ready = true;
      return model;
    },

    async _loadExpressions() {
      // Load every .exp3.json referenced by an emotion spec's `file`.
      const specs = cfg.emotionExpressions;
      const files = [...new Set(
        Object.values(specs).filter(Boolean).map((s) => s.file).filter(Boolean)
      )];
      await Promise.all(
        files.map(async (name) => {
          try {
            const res = await fetch("/model/" + encodeURIComponent(name) + ".exp3.json");
            if (!res.ok) return;
            const json = await res.json();
            this.expressions[name] = json.Parameters || [];
          } catch (_) {}
        })
      );

      // Compile each emotion into a single combined parameter list = the file's
      // params (if any) + custom `add` overrides. This is what we apply per frame.
      this.emotionSpecs = {};
      for (const [emotion, spec] of Object.entries(specs)) {
        if (!spec) { this.emotionSpecs[emotion] = null; continue; }
        const params = [];
        if (spec.file && this.expressions[spec.file]) {
          for (const p of this.expressions[spec.file]) params.push(p);
        }
        for (const [Id, Value] of spec.add || []) {
          params.push({ Id, Value, Blend: "Add" });
        }
        this.emotionSpecs[emotion] = params.length ? params : null;
      }

      // Union of all expression param ids; snapshot their neutral baseline now
      // (no expression applied) so per-frame we can reset then re-apply cleanly.
      const core = this.model.internalModel.coreModel;
      const ids = new Set();
      for (const params of Object.values(this.emotionSpecs)) {
        if (!params) continue;
        for (const p of params) ids.add(p.Id);
      }
      ids.delete(P.mouthOpen); // owned by lip-sync
      this.exprParamIds = [...ids];
      for (const id of this.exprParamIds) {
        try {
          this.exprBaseline[id] = core.getParameterValueById(id);
        } catch (_) {
          this.exprBaseline[id] = 0;
        }
      }
    },

    _layout() {
      const m = this.model;
      if (!m) return;
      const { width, height } = this.app.screen;
      // Half-body framing: enlarge so the character fills the view from the
      // head down to about the hips (lower body cropped by the viewport).
      const scale = (height * 1.6) / m.internalModel.height;
      m.scale.set(scale);
      m.anchor.set(0.5, 0);                        // anchor at top-center
      m.position.set(width / 2, -height * 0.05);   // small headroom above the hair
    },

    _tick(dtFrames) {
      const dt = dtFrames / 60;
      this._t += dt;

      // --- Lip-sync ---
      if (this.amplitudeMode) {
        this.mouthTarget = this._amp; // real audio amplitude (edge TTS)
      } else if (this.speaking) {
        const s =
          0.5 +
          0.32 * Math.sin(this._t * 17) +
          0.18 * Math.sin(this._t * 29 + 1.3) +
          0.12 * (Math.random() - 0.5);
        this.mouthTarget = Math.max(0, Math.min(1, s));
      } else {
        this.mouthTarget = 0;
      }
      const mSpeed = this.amplitudeMode ? 0.55 : (this.speaking ? 0.5 : 0.25);
      this.mouthValue += (this.mouthTarget - this.mouthValue) * mSpeed;

      // --- Expression fade ---
      this.exprTarget = this.activeExpr ? 1 : 0;
      this.exprWeight += (this.exprTarget - this.exprWeight) * 0.12;

      // --- Gaze: thinking > cursor > idle ---
      if (this.model) {
        const fc = this.model.internalModel.focusController;
        if (this.thinking) {
          // Glance up and to the side, as if pondering.
          fc.focus(0.35 + Math.sin(this._t * 1.1) * 0.12, 0.45 + Math.sin(this._t * 0.8) * 0.08);
        } else if (performance.now() - this.lastPointerMove > IDLE_GAZE_MS) {
          // Look straight at the viewer, with a tiny living drift.
          fc.focus(Math.sin(this._t * 0.5) * 0.06, Math.sin(this._t * 0.37) * 0.04);
        } else {
          // Follow the cursor (screen coordinates).
          this.model.focus(this.focusX, this.focusY);
        }
      }
    },

    _writeParams() {
      const core = this.model?.internalModel?.coreModel;
      if (!core) return;

      // Reset all expression params to their neutral baseline first, so nothing
      // from a previous expression lingers (absolute, non-accumulating).
      for (const id of this.exprParamIds) {
        try { core.setParameterValueById(id, this.exprBaseline[id]); } catch (_) {}
      }

      // Apply the active expression on top, blended by the eased weight.
      if (this.activeExpr && this.exprWeight > 0.001) {
        const w = this.exprWeight;
        for (const p of this.activeExpr) {
          if (p.Id === P.mouthOpen) continue; // owned by lip-sync
          try {
            const base = this.exprBaseline[p.Id] ?? core.getParameterValueById(p.Id);
            let v;
            const blend = p.Blend || "Add";
            if (blend === "Add") v = base + p.Value * w;
            else if (blend === "Multiply") v = base * (1 + (p.Value - 1) * w);
            else v = base + (p.Value - base) * w; // Overwrite
            core.setParameterValueById(p.Id, v);
          } catch (_) {}
        }
      }

      // Pinned params (e.g. hide the alternate raised-hand poses).
      if (cfg.pinnedParams) {
        for (const id in cfg.pinnedParams) {
          try { core.setParameterValueById(id, cfg.pinnedParams[id]); } catch (_) {}
        }
      }

      // Lip-sync last, so it always wins the mouth-open parameter.
      try {
        core.setParameterValueById(P.mouthOpen, this.mouthValue);
      } catch (_) {}
    },

    /* ---- Public API ---- */

    startSpeaking() { this.amplitudeMode = false; this.speaking = true; },
    stopSpeaking() { this.speaking = false; this.amplitudeMode = false; this._amp = 0; this.mouthTarget = 0; },
    setThinking(on) { this.thinking = Boolean(on); },
    // Feed a real 0..1 audio amplitude per frame (edge TTS lip-sync).
    setMouthAmplitude(a) {
      this.amplitudeMode = true;
      this.speaking = false;
      this._amp = Math.max(0, Math.min(1, a));
    },

    playExpression(emotion) {
      if (emotion === this.activeExprName) return; // no change
      this.activeExprName = emotion;
      const spec = this.emotionSpecs ? this.emotionSpecs[emotion] : null;
      if (spec) {
        this.activeExpr = spec;
        this.exprWeight = 0; // fade the new expression in smoothly
      } else {
        this.activeExpr = null; // neutral -> fade everything out
      }
    },

    playMotion(group, priority = 3) {
      if (!this.model) return;
      try {
        this.model.motion(group, undefined, priority);
      } catch (_) {}
    },

    greet() {
      // NOTE: we deliberately do NOT play the waving motion (HuiShou) here.
      // That motion animates Param58/Param59 and leaves the waving hand
      // half-shown when it ends (a floating semi-transparent hand). Instead we
      // greet with a shy blush to match her flustered tsundere hello.
      this.playExpression("shy");
    },
  };

  window.Live2DController = Live2DController;
})();
