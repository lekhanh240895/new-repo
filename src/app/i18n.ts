/**
 * UI text in English and Vietnamese. The `vi` table must have every key of
 * `en` (enforced by the type), so a missing translation is a compile error.
 */
import { useSyncExternalStore } from 'react'

export type Lang = 'en' | 'vi'

const en = {
  'app.title': 'BioMonitor DMS',
  'tab.trip': 'Trip',
  'tab.debug': 'Debug',
  'lang.label': 'Language',

  'idle.disclaimerTitle': 'Not a certified safety device.',
  'idle.disclaimerBody': 'It does not replace rest. You stay fully responsible for driving safely.',
  'idle.limits': 'Daytime only: the phone camera cannot see your face in the dark. Keep this app open in front.',
  'idle.privacy': 'Video never leaves your phone.',
  'idle.accept': 'I understand',
  'idle.mountTitle': 'How to mount your phone',
  'idle.mount1': 'Mount it on the dashboard or a center air vent, not behind the steering wheel.',
  'idle.mount2': 'Front camera at about eye level, pointing at your face.',
  'idle.mount3': 'Your face should fill about a quarter of the picture.',
  'idle.mount4': 'Keep the phone charging, and turn the screen brightness down.',
  'idle.location': 'Use location to stay quiet when the car is stopped',
  'idle.notify': 'Notify me if monitoring pauses',
  'idle.motion': 'Use motion sensors to recognize turns and stops',
  'idle.start': 'Start trip',
  'idle.update': 'A new version is ready.',
  'idle.updateNow': 'Update now',
  'idle.offline': 'Ready to work offline.',

  'status.permissions': 'Starting the camera…',
  'status.loading': 'Loading face tracking…',

  'setup.face': 'Face found',
  'setup.light': 'Light OK',
  'setup.size': 'Phone close enough',
  'setup.screen': 'Screen stays on',
  'setup.sound': 'Sound ready',
  'setup.beep': 'You should have heard a beep. If not, turn the media volume up.',

  'hint.noFace': "Can't see your face. Point the camera at you, at eye level.",
  'hint.dark': 'Too dark. Monitoring needs light on your face.',
  'hint.bright': 'Too bright or backlit. Adjust the mount to avoid glare.',
  'hint.small': 'Your face is too small in the picture. Move the phone closer.',

  'calib.prompt': 'Look at the road and blink normally.',
  'calib.retry.too-few-valid': "Couldn't see you clearly. Look at the road.",
  'calib.retry.moving': 'Please hold your head still and look at the road.',
  'calib.retry.no-blinks': 'Please blink normally.',

  'alarm.D1': 'Eyes on the road',
  'alarm.D2': 'Eyes on the road!',
  'alarm.L1': 'Stay awake',
  'alarm.L2': 'Wake up!',
  'alarm.L3': 'WAKE UP!',
  'alarm.ack': "I'm awake",

  'advisory.normal': 'Signs of fatigue. Plan a break soon.',
  'advisory.strong': 'You are tired. Please stop at a safe place.',

  'hud.ok': 'Monitoring',
  'hud.limited': 'Limited monitoring',
  'hud.advisory': 'Signs of fatigue',
  'hud.off': 'Not monitoring',
  'hud.alarm': 'Alarm',

  'cockpit.parked': 'Car looks parked: look-away alarms are off.',
  'cockpit.noSound': 'Sound is blocked: visual alerts only.',
  'cockpit.approx': 'Calibration is approximate.',
  'cockpit.recalibrate': 'Phone moved? Re-calibrate',
  'cockpit.recalibrating': 'Re-calibrating… look at the road.',
  'cockpit.battery': 'Battery low — connect the charger.',
  'cockpit.notMonitoring': "Not monitoring: can't see your face.",
  'cockpit.end': 'End trip',
  'cockpit.mountSide': 'The phone is far to the side. For better accuracy, move it toward the center.',

  'suspended': 'Monitoring paused. Come back to this app to continue.',

  'fault.title': 'Monitoring is off',
  'fault.CAMERA_DENIED': 'Camera permission was denied. Allow the camera in your browser settings, then start again.',
  'fault.CAMERA_LOST': 'The camera stopped or could not start.',
  'fault.MODEL_FAILED': 'The face model could not load.',
  'fault.WORKER_STALLED': 'Face tracking stopped responding.',
  'fault.AUDIO_BLOCKED': 'Sound is blocked.',
  'fault.SETUP_FAILED': 'Setup check failed.',
  'fault.gaveUp': 'Please end the trip and start again.',
  'fault.retry': 'Try again',
  'fault.end': 'End trip',

  'summary.title': 'Trip summary',
  'summary.time': 'Trip time',
  'summary.microsleep': 'Microsleep alerts',
  'summary.distraction': 'Eyes-off-road alerts',
  'summary.longest': 'Longest eye closure',
  'summary.rest': 'You had signs of microsleep. Rest before you drive again.',
  'summary.noAlerts': 'No alerts on this trip.',
  'summary.new': 'New trip',
  'summary.alertsTitle': 'Alerts on this trip',
  'summary.alertsHelp': 'Was an alert wrong? Mark it, and the app gives you a little more time next trip (up to +10%). Phone looks and long eye closures (L2, L3) never change.',
  'summary.alertD': 'Eyes off road',
  'summary.alertL': 'Microsleep / drowsy eyes',
  'summary.markFalse': 'False alarm',
  'summary.marked': 'Marked',
  'summary.atLimit': 'Already at the limit',
  'summary.alwaysCounted': 'Long eye closure: always counted',
  'summary.saveFailed': 'Could not save on this device.',
  'summary.personal': 'Your settings: eyes off road +{d}%, microsleep +{l}%.',
  'summary.personalReset': 'Reset to default',
  'unit.min': 'min',
  'unit.sec': 's',

  'notify.title': 'BioMonitor paused',
  'notify.body': 'Driver monitoring is off. Open the app to continue.',

  'debug.banner': 'Debug mode — parked or at a desk only. Never use it while driving.',
  'debug.moving': 'Debug mode stopped: the car is moving.',
} as const

export type TextKey = keyof typeof en

const vi: Record<TextKey, string> = {
  'app.title': 'BioMonitor DMS',
  'tab.trip': 'Chuyến đi',
  'tab.debug': 'Gỡ lỗi',
  'lang.label': 'Ngôn ngữ',

  'idle.disclaimerTitle': 'Không phải thiết bị an toàn được chứng nhận.',
  'idle.disclaimerBody': 'Ứng dụng không thay thế việc nghỉ ngơi. Bạn vẫn hoàn toàn chịu trách nhiệm lái xe an toàn.',
  'idle.limits': 'Chỉ dùng ban ngày: camera điện thoại không thấy mặt bạn trong bóng tối. Hãy luôn mở ứng dụng ở màn hình chính.',
  'idle.privacy': 'Video không bao giờ rời khỏi điện thoại của bạn.',
  'idle.accept': 'Tôi đã hiểu',
  'idle.mountTitle': 'Cách gắn điện thoại',
  'idle.mount1': 'Gắn trên taplo hoặc cửa gió điều hòa ở giữa, không đặt sau vô lăng.',
  'idle.mount2': 'Camera trước ngang tầm mắt, hướng vào mặt bạn.',
  'idle.mount3': 'Khuôn mặt chiếm khoảng một phần tư khung hình.',
  'idle.mount4': 'Cắm sạc điện thoại và giảm độ sáng màn hình.',
  'idle.location': 'Dùng vị trí để không báo động khi xe đang dừng',
  'idle.notify': 'Thông báo khi giám sát bị tạm dừng',
  'idle.motion': 'Dùng cảm biến chuyển động để nhận biết khúc cua và lúc dừng xe',
  'idle.start': 'Bắt đầu chuyến đi',
  'idle.update': 'Đã có phiên bản mới.',
  'idle.updateNow': 'Cập nhật ngay',
  'idle.offline': 'Sẵn sàng hoạt động không cần mạng.',

  'status.permissions': 'Đang mở camera…',
  'status.loading': 'Đang tải nhận diện khuôn mặt…',

  'setup.face': 'Đã thấy khuôn mặt',
  'setup.light': 'Đủ ánh sáng',
  'setup.size': 'Điện thoại đủ gần',
  'setup.screen': 'Màn hình luôn sáng',
  'setup.sound': 'Âm thanh sẵn sàng',
  'setup.beep': 'Bạn vừa nghe một tiếng bíp. Nếu không nghe thấy, hãy tăng âm lượng.',

  'hint.noFace': 'Không thấy khuôn mặt. Hãy hướng camera vào bạn, ngang tầm mắt.',
  'hint.dark': 'Quá tối. Cần có ánh sáng chiếu vào mặt bạn.',
  'hint.bright': 'Quá chói hoặc ngược sáng. Hãy chỉnh lại vị trí gắn.',
  'hint.small': 'Khuôn mặt quá nhỏ trong khung hình. Hãy đưa điện thoại lại gần hơn.',

  'calib.prompt': 'Hãy nhìn đường và chớp mắt bình thường.',
  'calib.retry.too-few-valid': 'Không nhìn rõ bạn. Hãy nhìn về phía đường.',
  'calib.retry.moving': 'Hãy giữ đầu yên và nhìn đường.',
  'calib.retry.no-blinks': 'Hãy chớp mắt bình thường.',

  'alarm.D1': 'Hãy nhìn đường',
  'alarm.D2': 'Nhìn đường!',
  'alarm.L1': 'Hãy tỉnh táo',
  'alarm.L2': 'Tỉnh dậy!',
  'alarm.L3': 'TỈNH DẬY!',
  'alarm.ack': 'Tôi đã tỉnh',

  'advisory.normal': 'Có dấu hiệu mệt mỏi. Hãy sớm nghỉ ngơi.',
  'advisory.strong': 'Bạn đang mệt. Hãy dừng xe ở nơi an toàn.',

  'hud.ok': 'Đang giám sát',
  'hud.limited': 'Giám sát hạn chế',
  'hud.advisory': 'Dấu hiệu mệt mỏi',
  'hud.off': 'Không giám sát',
  'hud.alarm': 'Báo động',

  'cockpit.parked': 'Xe có vẻ đang đỗ: báo động nhìn lệch đang tắt.',
  'cockpit.noSound': 'Âm thanh bị chặn: chỉ cảnh báo bằng hình.',
  'cockpit.approx': 'Hiệu chuẩn chưa hoàn toàn chính xác.',
  'cockpit.recalibrate': 'Điện thoại bị lệch? Hiệu chuẩn lại',
  'cockpit.recalibrating': 'Đang hiệu chuẩn lại… hãy nhìn đường.',
  'cockpit.battery': 'Pin yếu — hãy cắm sạc.',
  'cockpit.notMonitoring': 'Không giám sát được: không thấy khuôn mặt.',
  'cockpit.end': 'Kết thúc chuyến đi',
  'cockpit.mountSide': 'Điện thoại gắn quá lệch sang bên. Để chính xác hơn, hãy dời về gần giữa.',

  'suspended': 'Đã tạm dừng giám sát. Hãy quay lại ứng dụng để tiếp tục.',

  'fault.title': 'Giám sát đang tắt',
  'fault.CAMERA_DENIED': 'Quyền camera bị từ chối. Hãy cho phép camera trong cài đặt trình duyệt rồi bắt đầu lại.',
  'fault.CAMERA_LOST': 'Camera đã dừng hoặc không khởi động được.',
  'fault.MODEL_FAILED': 'Không tải được mô hình nhận diện khuôn mặt.',
  'fault.WORKER_STALLED': 'Nhận diện khuôn mặt không phản hồi.',
  'fault.AUDIO_BLOCKED': 'Âm thanh bị chặn.',
  'fault.SETUP_FAILED': 'Kiểm tra thiết lập không đạt.',
  'fault.gaveUp': 'Hãy kết thúc và bắt đầu lại chuyến đi.',
  'fault.retry': 'Thử lại',
  'fault.end': 'Kết thúc',

  'summary.title': 'Tóm tắt chuyến đi',
  'summary.time': 'Thời gian',
  'summary.microsleep': 'Cảnh báo ngủ gật',
  'summary.distraction': 'Cảnh báo mất tập trung',
  'summary.longest': 'Lần nhắm mắt lâu nhất',
  'summary.rest': 'Bạn đã có dấu hiệu ngủ gật. Hãy nghỉ ngơi trước khi lái tiếp.',
  'summary.noAlerts': 'Không có cảnh báo nào trong chuyến đi này.',
  'summary.new': 'Chuyến mới',
  'summary.alertsTitle': 'Cảnh báo trong chuyến',
  'summary.alertsHelp': 'Có cảnh báo nào sai không? Đánh dấu nó, chuyến sau ứng dụng sẽ cho bạn thêm chút thời gian (tối đa +10%). Nhìn điện thoại và nhắm mắt lâu (L2, L3) không bao giờ thay đổi.',
  'summary.alertD': 'Mắt rời khỏi đường',
  'summary.alertL': 'Ngủ gật / mắt buồn ngủ',
  'summary.markFalse': 'Báo sai',
  'summary.marked': 'Đã đánh dấu',
  'summary.atLimit': 'Đã đến giới hạn',
  'summary.alwaysCounted': 'Nhắm mắt lâu: luôn được tính',
  'summary.saveFailed': 'Không lưu được trên máy này.',
  'summary.personal': 'Cài đặt của bạn: mắt rời đường +{d}%, ngủ gật +{l}%.',
  'summary.personalReset': 'Đặt lại mặc định',
  'unit.min': 'phút',
  'unit.sec': 'giây',

  'notify.title': 'BioMonitor đã tạm dừng',
  'notify.body': 'Giám sát tài xế đang tắt. Mở ứng dụng để tiếp tục.',

  'debug.banner': 'Chế độ gỡ lỗi — chỉ dùng khi xe đã dừng hoặc tại bàn. Không dùng khi đang lái.',
  'debug.moving': 'Đã tắt chế độ gỡ lỗi: xe đang di chuyển.',
}

export const STRINGS: Record<Lang, Record<TextKey, string>> = { en, vi }

const STORAGE_KEY = 'biomonitor.lang'

/** Saved choice, else the phone's language. Storage may be unavailable (private mode). */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'vi') return saved
  } catch {
    // Storage blocked: fall through to the browser language.
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

let current: Lang = typeof window === 'undefined' ? 'en' : detectLang()
if (typeof document !== 'undefined') document.documentElement.lang = current
const listeners = new Set<() => void>()

export function currentLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Not saved; the choice still applies for this session.
  }
  document.documentElement.lang = lang
  for (const l of listeners) l()
}

export function translate(lang: Lang, key: TextKey): string {
  return STRINGS[lang][key]
}

export function useLang(): { lang: Lang; t: (key: TextKey) => string } {
  const lang = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
  return { lang, t: (key) => translate(lang, key) }
}
