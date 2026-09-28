/* Global configuration for the IceGirl assistant. */
window.APP_CONFIG = {
  // Path (served by the backend) to the Live2D model definition.
  modelUrl: "/model/IceGirl.model3.json",

  // Backend chat endpoint.
  chatEndpoint: "/api/chat",

  // Map AI emotion tags -> the model's expression files (.exp3.json names,
  // without extension). The IceGirl model ships expressions with Chinese
  // filenames; these are the closest matches.
  //   惊讶=surprised  星星眼=star-eyes  爱心眼=heart-eyes  生气=angry
  //   疑惑=confused    流泪=tears        脸红=blush         舌头=tongue-out
  //   白眼=eye-roll    脸黑=dark-face
  //
  // Each emotion maps to an expression SPEC:
  //   null                         -> neutral (no expression)
  //   { file: "名字" }             -> the model's .exp3.json of that name
  //   { add: [["ParamId", value]] }-> custom parameter overrides (added on top)
  //   { file, add }                -> both, combined
  // Custom `add` params let us build stronger faces (e.g. a real smile) that
  // the shipped expressions lack, so Yuki never looks flat.
  emotionExpressions: {
    neutral:   null,
    // Real smile: mouth up + smiling eyes.
    happy:     { add: [["ParamMouthForm", 1], ["ParamEyeLSmile", 1], ["ParamEyeRSmile", 1]] },
    // Sparkle eyes + big grin.
    excited:   { file: "星星眼", add: [["ParamMouthForm", 1], ["ParamEyeLSmile", 0.6], ["ParamEyeRSmile", 0.6]] },
    love:      { file: "爱心眼", add: [["ParamMouthForm", 0.7]] },
    // Blush + glance away + tiny pout + raised brows (flustered tsundere).
    shy:       { file: "脸红", add: [["ParamEyeBallX", -0.5], ["ParamMouthForm", -0.35], ["ParamBrowLForm", 0.35], ["ParamBrowRForm", 0.35]] },
    angry:     { file: "生气" },
    sad:       { file: "流泪" },
    surprised: { file: "惊讶" },
    confused:  { file: "疑惑" },
    // Tongue out + one eye squint + smile (cheeky).
    playful:   { file: "舌头", add: [["ParamEyeLOpen", -0.6], ["ParamMouthForm", 0.6]] },
  },

  // Optional motion groups to play on certain events (from *.motion3.json).
  motions: {
    greeting: "HuiShou", // waving
    idle: "DaiJi",       // standby
  },

  // Parameters pinned to a fixed value every frame. The IceGirl model ships
  // with two alternate "raised hand" poses shown by default, which float to the
  // left and right of the body and look like faint extra hands in the half-body
  // framing. Pinning them to 1 hides both for a clean portrait.
  pinnedParams: {
    Param41: 1, // hide the left raised-hand pose
    Param51: 1, // hide the right raised-hand pose
    Param59: 1, // hide the waving hand (the greeting motion leaves it half-shown)
  },

  // Standard Cubism parameter ids used for lip-sync and blinking.
  params: {
    mouthOpen: "ParamMouthOpenY",
    mouthForm: "ParamMouthForm",
    eyeLOpen: "ParamEyeLOpen",
    eyeROpen: "ParamEyeROpen",
    angleX: "ParamAngleX",
    angleY: "ParamAngleY",
    bodyAngleX: "ParamBodyAngleX",
  },
};
