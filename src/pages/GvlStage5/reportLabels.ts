const descriptions: Record<string, string> = {
  SHARED_NAME_MULTIPLE_CABLE_LOOPS: 'Общо означение за различни кабелни контури',
  NO_OWN_TAG_OR_PROVEN_PARENT: 'Липсва собствен таг или доказана връзка с оборудване',
  DOCUMENT_RELATION_NEEDS_REVIEW: 'Връзката в документа изисква проверка',
  DOCUMENT_PARENT_NOT_IN_MODEL: 'Оборудването от документа не е намерено в модела',
  MODEL_TAG_QUESTION_MARK: 'Неясно означение в модела',
  OBSOLETE_BINDING: 'Остаряло присвояване',
  MODEL_SCOPE_CHANGED: 'Променена моделна ревизия',
  BINDING_MISSING: 'Липсва присвояване',
  assigned: 'Потвърдено',
  superseded: 'Заменено',
  unverified: 'Непотвърдено',
  'changed-scope': 'Променена ревизия',
  'model-family-tag': 'Съвпадение по моделно означение',
  'pid-equipment': 'Връзка с оборудване от P&ID',
  'own-tag': 'Собствен таг',
  'own-tag-notation': 'Вариант на собствен таг',
  'user-cabinet': 'Потвърдено проектно правило за табло',
};

export const label = (value: string) => Object.hasOwn(descriptions, value) ? descriptions[value] : value;

export const scopeLabels = {
  current: 'Сверен с WFC',
  changed: 'Установена промяна спрямо изходните данни',
  historical: 'Исторически отчет',
};
