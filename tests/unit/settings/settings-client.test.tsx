// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ar } from '@/i18n/ar'
import { SETTINGS_CATALOG, type SettingKey } from '@/lib/settings/catalog'
import type { SettingDto } from '@/modules/setting/types'
import { fireEvent, render, screen } from '@tests/helpers/render'

/**
 * The Settings page's *behaviour*, not its markup.
 *
 * Four promises SPEC §7 makes about this screen, each of which is invisible
 * until it is broken:
 *
 *   1. read-only for `settings.view` alone — the controls are disabled and the
 *      save bar is not rendered at all;
 *   2. one draft, one save — nothing is written until the button is pressed,
 *      and then everything changed goes in a single call;
 *   3. an invalid value is caught in the browser, on the field, before the
 *      action is called;
 *   4. a saved taxonomy id cannot be retyped, because `Task.categoryId` points
 *      at it.
 *
 * The action is mocked because this is a component test; the server-side half
 * of every one of these rules is asserted for real in
 * `tests/unit/setting/service.test.ts` and the integration suite.
 */

interface UpdatePayload {
  updates: Array<{ key: string; value: unknown }>
}

const updateSettingsAction = vi.fn(async (_payload: UpdatePayload) => [])

vi.mock('@/modules/setting/actions', () => ({
  updateSettingsAction: (payload: UpdatePayload) => updateSettingsAction(payload),
  updateSettingAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

const { SettingsClient } = await import('@/app/(app)/settings/settings-client')
const { ToastProvider } = await import('@/components/shared/toast')

function setting(key: SettingKey, value?: unknown): SettingDto {
  return {
    key,
    group: SETTINGS_CATALOG[key].group,
    value: value === undefined ? SETTINGS_CATALOG[key].default : value,
    isDefault: value === undefined,
    updatedAt: null,
    updatedById: null,
  }
}

function renderSettings(canEdit = true) {
  return render(
    <ToastProvider>
      <SettingsClient
        canEdit={canEdit}
        holidaysSlot={<div data-testid="holidays" />}
        groups={[
          {
            group: 'penalty',
            settings: [
              setting('penalty.defaultGraceHours'),
              setting('penalty.penalizeRevisionLateness'),
            ],
          },
          {
            group: 'tasks',
            settings: [setting('tasks.categories'), setting('tasks.dueSoonDays')],
          },
          {
            group: 'performance',
            settings: [
              setting('performance.weightOnTime'),
              setting('performance.weightQuality'),
              setting('performance.weightVolume'),
              setting('performance.weightEstimateAccuracy'),
            ],
          },
        ]}
      />
    </ToastProvider>,
  )
}

/**
 * `exact: false` because the `<Label>` carries more than the key's name: a
 * setting still at its catalog value also renders an "القيمة الافتراضية" badge
 * inside the same label, which is deliberate — it is the one place a reader
 * learns nobody has touched this rule — and it becomes part of the control's
 * accessible name.
 */
const field = (key: SettingKey) =>
  screen.getByLabelText(ar.settings.keys[key], { exact: false })

const graceField = () => field('penalty.defaultGraceHours')
const saveButton = () => screen.getByRole('button', { name: ar.settings.save })

describe('صفحة الإعدادات — صلاحية الاطّلاع دون التعديل', () => {
  it('تعطّل كل الحقول ولا تعرض شريط الحفظ', () => {
    renderSettings(false)

    expect(screen.getByText(ar.settings.readOnly)).toBeTruthy()
    expect(graceField()).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: ar.settings.save })).toBeNull()
  })
})

describe('صفحة الإعدادات — مسودة واحدة وحفظ واحد', () => {
  it('لا تكتب شيئًا قبل الضغط على الحفظ', () => {
    renderSettings()

    fireEvent.change(graceField(), { target: { value: '48' } })

    expect(updateSettingsAction).not.toHaveBeenCalled()
    expect(
      screen.getByText(ar.settings.unsavedChanges.replace('{count}', '1')),
    ).toBeTruthy()
  })

  it('ترسل كل التغييرات في نداء واحد', () => {
    renderSettings()

    fireEvent.change(graceField(), { target: { value: '48' } })
    fireEvent.change(field('tasks.dueSoonDays'), { target: { value: '10' } })
    fireEvent.click(saveButton())

    expect(updateSettingsAction).toHaveBeenCalledTimes(1)
    const payload = updateSettingsAction.mock.calls[0]?.[0]
    if (!payload) throw new Error('the action was called with no payload')
    expect(payload.updates).toEqual(
      expect.arrayContaining([
        { key: 'penalty.defaultGraceHours', value: 48 },
        { key: 'tasks.dueSoonDays', value: 10 },
      ]),
    )
    // Only what actually changed — an untouched setting is not rewritten, so a
    // save cannot stamp `updatedById` on rules nobody edited.
    expect(payload.updates).toHaveLength(2)
  })

  it('لا ترسل شيئًا حين لا يوجد تغيير', () => {
    renderSettings()
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(screen.getByText(ar.settings.noChanges)).toBeTruthy()
  })

  it('التراجع يعيد القيم الأصلية', () => {
    renderSettings()

    fireEvent.change(graceField(), { target: { value: '48' } })
    fireEvent.click(screen.getByRole('button', { name: ar.settings.discard }))

    expect((graceField() as HTMLInputElement).value).toBe(
      String(SETTINGS_CATALOG['penalty.defaultGraceHours'].default),
    )
    expect(screen.getByText(ar.settings.noChanges)).toBeTruthy()
  })
})

describe('صفحة الإعدادات — التحقق قبل الإرسال', () => {
  it('ترفض قيمة سالبة على الحقل ولا تنادي الإجراء', () => {
    renderSettings()

    // The catalog says `nonNegativeInt`; the browser check exists so the
    // operator sees *which* box is wrong, and the server checks again.
    fireEvent.change(graceField(), { target: { value: '-5' } })
    fireEvent.click(saveButton())

    expect(updateSettingsAction).not.toHaveBeenCalled()
    expect(screen.getAllByText(ar.settings.invalidValue).length).toBeGreaterThan(0)
  })

  it('حقل رقمي فارغ لا يُحفظ كصفر', () => {
    renderSettings()

    fireEvent.change(graceField(), { target: { value: '' } })
    fireEvent.click(saveButton())

    // An empty box is not zero. Saving it as one would silently set a grace
    // period nobody chose — on a field that decides deductions.
    expect(updateSettingsAction).not.toHaveBeenCalled()
  })
})

describe('صفحة الإعدادات — معرّفات التصنيفات ثابتة', () => {
  it('معرّف تصنيف محفوظ غير قابل للتعديل، والاسم قابل', () => {
    renderSettings()

    const ids = screen.getAllByLabelText(ar.settings.list.itemId)
    const labels = screen.getAllByLabelText(ar.settings.list.itemLabel)

    // `Task.categoryId` points at the id; retyping it would orphan every task
    // filed under it (SPEC §7).
    expect(ids[0]).toHaveProperty('disabled', true)
    expect(labels[0]).toHaveProperty('disabled', false)
  })

  it('عنصر جديد يبقى معرّفه قابلًا للتعديل حتى الحفظ', () => {
    renderSettings()

    const before = screen.getAllByLabelText(ar.settings.list.itemId).length
    fireEvent.click(screen.getAllByRole('button', { name: ar.settings.list.addItem })[0]!)

    const after = screen.getAllByLabelText(ar.settings.list.itemId)
    expect(after).toHaveLength(before + 1)
    // Nothing references it yet, so it is still free to name.
    expect(after[after.length - 1]).toHaveProperty('disabled', false)
  })
})

describe('صفحة الإعدادات — مجموع أوزان الأداء', () => {
  it('يعرض المجموع ولا يمنع الحفظ حين لا يساوي 100', () => {
    renderSettings()

    fireEvent.change(field('performance.weightOnTime'), { target: { value: '40' } })

    // Advisory, not a gate: `computePerformanceScore` divides by the actual
    // sum (SPEC §5.6), so 90 is a valid configuration.
    expect(screen.getByText(ar.settings.weights.notHundred)).toBeTruthy()
    expect(saveButton()).toHaveProperty('disabled', false)
  })

  it('لا يعرض التحذير حين يساوي المجموع 100', () => {
    renderSettings()
    expect(screen.queryByText(ar.settings.weights.notHundred)).toBeNull()
  })
})

describe('صفحة الإعدادات — العطلات جزء من الصفحة', () => {
  it('تعرض بطاقة العطلات مهما كانت صلاحية التعديل', () => {
    renderSettings(false)

    // Twice on purpose: once in the section index, once as the card's title.
    expect(screen.getAllByText(ar.settings.groups.holidays)).toHaveLength(2)
    expect(screen.getByTestId('holidays')).toBeTruthy()
    expect(screen.getByText(ar.settings.groupHints.holidays)).toBeTruthy()
  })
})
