const dummyIcon =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjWHpl7X8AB24DJsTeKbEAAAAASUVORK5CYII=";

export const dummyEngineManifest = {
  manifest_version: "0.13.1",
  name: "VOICEVOX Engine SW",
  brand_name: "VOICEVOX",
  uuid: "680C0D1C-A5A6-416B-955D-1093A702EDCD",
  url: "https://github.com/VOICEVOX/voicevox",
  icon: dummyIcon,
  default_sampling_rate: 24000,
  frame_rate: 93.75,
  terms_of_service: "NONE",
  update_infos: [],
  dependency_licenses: [],
  supported_vvlib_manifest_version: undefined,
  supported_features: {
    adjust_mora_pitch: false,
    adjust_phoneme_length: false,
    adjust_speed_scale: false,
    adjust_pitch_scale: false,
    adjust_intonation_scale: false,
    adjust_volume_scale: false,
    adjust_pause_length: false,
    interrogative_upspeak: false,
    synthesis_morphing: false,
    sing: false,
    manage_library: false,
    return_resource_url: false,
    apply_katakana_english: false,
  },
};

export const dummySupportedDevices = {
  cpu: true,
  cuda: false,
  dml: false,
};

export const dummySpeakers = [
  {
    speaker_uuid: "9A6CC0AB-5BDB-497A-980F-8B5D59C9A615",
    name: "vv_core_inference",
    styles: [
      {
        name: "0",
        id: 0,
        type: undefined,
      },
      {
        name: "1",
        id: 1,
        type: undefined,
      },
      {
        name: "2",
        id: 2,
        type: undefined,
      },
      {
        name: "3",
        id: 3,
        type: undefined,
      },
      {
        name: "4",
        id: 4,
        type: undefined,
      },
    ],
    version: "0.0.3",
    supported_features: undefined,
  },
];

export const dummySpeakerInfo = {
  policy: `Dummy policy for ${dummySpeakers[0].speaker_uuid}`,
  portrait: dummyIcon,
  style_infos: [
    {
      id: 0,
      portrait: undefined,
      icon: dummyIcon,
      voice_samples: [],
    },
    {
      id: 1,
      portrait: undefined,
      icon: dummyIcon,
      voice_samples: [],
    },
    {
      id: 2,
      portrait: undefined,
      icon: dummyIcon,
      voice_samples: [],
    },
    {
      id: 3,
      portrait: undefined,
      icon: dummyIcon,
      voice_samples: [],
    },
    {
      id: 4,
      portrait: undefined,
      icon: dummyIcon,
      voice_samples: [],
    },
  ],
};
