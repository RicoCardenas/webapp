export const accountState = {
  user: null,
  roles: new Set(),
};

export const teacherState = { bound: false };
export const adminState = {
  bound: false,
  teachers: [],
  groups: [],
  selectedGroupId: null,
  groupDetail: null,
  creatingGroup: false,
  loadingTeachers: false,
  loadingGroups: false,
  loadingGroupDetail: false,
};
export const developmentState = {
  bound: false,
  admins: [],
  adminsTotal: 0,
  adminsLoading: false,
  opsLoading: false,
  opsEvents: [],
  opsTotal: 0,
  opsPage: 1,
  opsPageSize: 20,
  opsHasNext: false,
  opsHasPrev: false,
  opsPaginationBound: false,
  opsNeedsRefresh: false,
  opsUnsubscribe: null,
};

export const developmentRemovalState = { target: null, loading: false };
export const adminRequestState = { bound: false, loading: false, status: 'none' };

export const dashboardState = {
  layout: null,
  draft: null,
  bound: false,
  key: null,
};
