import { type FormEvent, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

export type AdminSection =
  'overview' | 'connections' | 'field-mappings' | 'settings' | 'members' | 'operations';
export type AdminLocale = 'ar' | 'en';
export type AdminDirection = 'rtl' | 'ltr';
export type AuthenticatedUser = {
  id: string;
  accountId: string;
  email: string;
  role: 'owner' | 'admin' | 'operator' | 'viewer';
};

type Connection = {
  id: string;
  platform: string;
  storeUrl: string;
  displayName: string | null;
  status: string;
  healthStatus: string;
  syncStatus: string;
  syncLastSuccessAt: string | null;
  syncOrdersCount: number;
  syncCatalogCount: number;
};
type Account = {
  id: string;
  name: string;
  locale: 'ar-EG' | 'en-US';
  direction: AdminDirection;
  timezone: string;
  baseCurrency: string;
};
type FieldCatalog = {
  id: string;
  connectionId: string;
  scope: string;
  sourceKey: string;
  sensitivity: 'safe' | 'private' | 'unknown';
  inferredType: string;
  occurrences: number;
  sample: unknown;
  discoveredAt: string;
};
type FieldMapping = {
  id: string;
  sourceKey: string;
  label: string;
  type: string;
  targetFacet: string | null;
  version: number;
};
type Member = {
  userId: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};
type OperationJob = {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead-lettered';
  progress: number;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
};
type ApiHealth = {
  health: {
    database: string;
    schemaVersion: number;
    queue: { queued: number; running: number; deadLettered: number };
  };
  runner: { running: boolean; active: number; registeredTypes: string[] };
};
type ApiUsage = {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  payloadBytes: number;
};

const translations = {
  ar: {
    overview: 'نظرة عامة',
    connections: 'الربط والمتاجر',
    mappings: 'خرائط الحقول',
    settings: 'الإعدادات',
    members: 'الأعضاء',
    operations: 'العمليات',
    loading: 'جارٍ التحميل',
    retry: 'إعادة المحاولة',
    forbidden: 'ليس لديك صلاحية لعرض هذا القسم.',
    partial: 'تم تحميل جزء من البيانات فقط. راجع العناصر الفاشلة وحاول مرة أخرى.',
    empty: 'لا توجد بيانات بعد.',
    account: 'الحساب',
    queue: 'قائمة المهام',
    database: 'قاعدة البيانات',
    runner: 'المعالج',
    connected: 'متصل',
    noConnections: 'لا توجد متاجر مربوطة بعد. ابدأ بربط WooCommerce.',
    readOnly: 'الربط للقراءة فقط؛ لا يتم تعديل الطلبات أو المخزون على WooCommerce.',
    storeUrl: 'رابط المتجر',
    connect: 'بدء ربط WooCommerce',
    authorizationReady: 'تم تجهيز رابط التفويض الخارجي. أكمل الربط في WooCommerce.',
    healthCheck: 'فحص الصحة',
    sync: 'مزامنة أولية',
    incremental: 'مزامنة جديدة',
    webhookSetup: 'إعداد Webhook',
    webhookInstructions:
      'انسخ الرابط والسر الآن إلى WooCommerce ← الإعدادات ← متقدم ← Webhooks. أنشئ Webhook مفعّلًا لكل حدث: Order created وOrder updated وOrder deleted. لن يظهر السر مرة أخرى؛ إنشاء سر جديد يلغي القديم.',
    reconcile: 'مطابقة وحذف محلي',
    syncQueued: 'تم وضع المهمة في القائمة',
    selectConnection: 'اختر المتجر',
    fieldCatalog: 'كتالوج الحقول الآمنة',
    fieldMappings: 'الخرائط النشطة',
    noCatalog: 'لم يتم اكتشاف حقول آمنة بعد. شغّل مزامنة للطلبة أولاً.',
    sourceKey: 'مفتاح الحقل',
    label: 'الاسم الظاهر',
    type: 'النوع',
    targetFacet: 'التصنيف المستهدف',
    saveMapping: 'حفظ الخريطة',
    backfill: 'تعبئة الطلبات الحالية',
    mappingSaved: 'تم حفظ الخريطة ووضع التعبئة في قائمة المهام.',
    profile: 'بيانات الحساب',
    accountName: 'اسم الحساب',
    locale: 'اللغة',
    direction: 'الاتجاه',
    timezone: 'المنطقة الزمنية',
    baseCurrency: 'العملة الأساسية',
    save: 'حفظ',
    password: 'تغيير كلمة المرور',
    currentPassword: 'كلمة المرور الحالية',
    newPassword: 'كلمة المرور الجديدة',
    saved: 'تم الحفظ',
    membersTitle: 'أعضاء الحساب',
    email: 'البريد الإلكتروني',
    role: 'الدور',
    invite: 'دعوة عضو',
    inviteSent: 'تم إنشاء الدعوة. انسخ رمز الدعوة من نتيجة العملية عند الحاجة.',
    revoke: 'إلغاء الوصول',
    pendingInvitations: 'الدعوات المعلقة',
    jobs: 'المهام الدائمة',
    usage: 'الاستخدام',
    status: 'الحالة',
    progress: 'التقدم',
    actions: 'الإجراءات',
    cancel: 'إلغاء',
    replay: 'إعادة تشغيل',
    deadLetters: 'المهام الفاشلة نهائياً',
    noJobs: 'لا توجد مهام في القائمة.',
    noDeadLetters: 'لا توجد مهام فاشلة نهائياً.',
    runMaintenance: 'تشغيل صيانة النظام',
    maintenanceQueued: 'تم وضع صيانة النظام في قائمة المهام.',
    signIn: 'تسجيل الدخول',
    register: 'إنشاء حساب مدير',
    emailInput: 'البريد الإلكتروني',
    passwordInput: 'كلمة المرور',
    accountNameInput: 'اسم الحساب',
    submit: 'متابعة',
    switchToRegister: 'إنشاء حساب جديد',
    switchToLogin: 'لديك حساب؟ تسجيل الدخول',
    sessionExpired: 'انتهت الجلسة. سجل الدخول مرة أخرى للمتابعة.',
    signOut: 'تسجيل الخروج',
    externalOnly: 'إجراء خارجي',
  },
  en: {
    overview: 'Overview',
    connections: 'Connections',
    mappings: 'Field mappings',
    settings: 'Settings',
    members: 'Members',
    operations: 'Operations',
    loading: 'Loading',
    retry: 'Retry',
    forbidden: 'You do not have permission to view this section.',
    partial: 'Only part of the data loaded. Review failed items and retry.',
    empty: 'No data yet.',
    account: 'Account',
    queue: 'Job queue',
    database: 'Database',
    runner: 'Runner',
    connected: 'Connected',
    noConnections: 'No stores are connected yet. Start a WooCommerce connection.',
    readOnly: 'Connections are read-only; WooCommerce orders and inventory are never changed.',
    storeUrl: 'Store URL',
    connect: 'Start WooCommerce connection',
    authorizationReady:
      'An external authorization URL is ready. Finish the connection in WooCommerce.',
    healthCheck: 'Health check',
    sync: 'Initial sync',
    incremental: 'Incremental sync',
    webhookSetup: 'Set up webhook',
    webhookInstructions:
      'Copy this URL and secret now into WooCommerce → Settings → Advanced → Webhooks. Create an active webhook for each of Order created, Order updated and Order deleted. The secret is shown only now; generating another replaces it.',
    reconcile: 'Reconcile locally',
    syncQueued: 'Job queued',
    selectConnection: 'Select a store',
    fieldCatalog: 'Safe field catalog',
    fieldMappings: 'Active mappings',
    noCatalog: 'No safe fields have been discovered yet. Run an order sync first.',
    sourceKey: 'Source key',
    label: 'Display label',
    type: 'Type',
    targetFacet: 'Target facet',
    saveMapping: 'Save mapping',
    backfill: 'Backfill existing orders',
    mappingSaved: 'Mapping saved and backfill queued.',
    profile: 'Account profile',
    accountName: 'Account name',
    locale: 'Locale',
    direction: 'Direction',
    timezone: 'Timezone',
    baseCurrency: 'Base currency',
    save: 'Save',
    password: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    saved: 'Saved',
    membersTitle: 'Account members',
    email: 'Email',
    role: 'Role',
    invite: 'Invite member',
    inviteSent:
      'Invitation created. Copy the invitation token from the operation result if needed.',
    revoke: 'Revoke access',
    pendingInvitations: 'Pending invitations',
    jobs: 'Durable jobs',
    usage: 'Usage',
    status: 'Status',
    progress: 'Progress',
    actions: 'Actions',
    cancel: 'Cancel',
    replay: 'Replay',
    deadLetters: 'Dead letters',
    noJobs: 'No jobs in the queue.',
    noDeadLetters: 'No dead-letter jobs.',
    runMaintenance: 'Run system maintenance',
    maintenanceQueued: 'System maintenance was queued.',
    signIn: 'Sign in',
    register: 'Create admin account',
    emailInput: 'Email',
    passwordInput: 'Password',
    accountNameInput: 'Account name',
    submit: 'Continue',
    switchToRegister: 'Create a new account',
    switchToLogin: 'Already have an account? Sign in',
    sessionExpired: 'Your session expired. Sign in again to continue.',
    signOut: 'Sign out',
    externalOnly: 'External action',
  },
} as const;

type Copy = (typeof translations)[AdminLocale];

class AdminApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

const csrfToken = (): string => document.cookie.match(/(?:^|;\s*)woo_ops_csrf=([^;]+)/u)?.[1] ?? '';

const apiRequest = async <T,>(
  path: string,
  onSessionExpired: () => void,
  options: RequestInit = {},
): Promise<T> => {
  const response = await fetch(path, { ...options, credentials: 'include' });
  if (response.status === 401) {
    onSessionExpired();
    throw new AdminApiError(401, 'AUTH_UNAUTHENTICATED');
  }
  if (response.status === 403) throw new AdminApiError(403, 'FORBIDDEN');
  if (!response.ok) {
    let message = `HTTP_${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      message = body.error?.code ?? message;
    } catch {
      // Keep a safe status-only error when the server did not return JSON.
    }
    throw new AdminApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const writeOptions = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
  body: JSON.stringify(body),
});

function StateBlock({
  copy,
  loading,
  error,
  forbidden,
  empty,
  onRetry,
}: {
  copy: Copy;
  loading: boolean;
  error: boolean;
  forbidden?: boolean;
  empty?: boolean;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <Box py={6} textAlign="center" data-testid="admin-loading">
        <CircularProgress aria-label={copy.loading} />
      </Box>
    );
  if (forbidden)
    return (
      <Alert severity="warning" data-testid="admin-forbidden">
        {copy.forbidden}
      </Alert>
    );
  if (error)
    return (
      <Alert
        severity="error"
        data-testid="admin-error"
        action={
          <Button color="inherit" size="small" onClick={onRetry}>
            {copy.retry}
          </Button>
        }
      >
        {copy.partial}
      </Alert>
    );
  if (empty)
    return (
      <Alert severity="info" data-testid="admin-empty">
        {copy.empty}
      </Alert>
    );
  return null;
}

export function LoginScreen({
  locale,
  direction,
  onAuthenticated,
  message,
}: {
  locale: AdminLocale;
  direction: AdminDirection;
  onAuthenticated: (user: AuthenticatedUser) => void;
  message?: string;
}) {
  const copy = translations[locale];
  const [register, setRegister] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountName, setAccountName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/v1/auth/setup', { credentials: 'include' })
      .then((response) => response.json())
      .then((body: { registrationOpen: boolean }) => {
        setRegistrationOpen(body.registrationOpen);
        setRegister(body.registrationOpen);
      })
      .catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(register ? '/api/v1/auth/register' : '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(register ? { email, password, accountName } : { email, password }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { code?: string } };
        throw new Error(body.error?.code ?? 'AUTH_FAILED');
      }
      const body = (await response.json()) as { user: AuthenticatedUser };
      onAuthenticated(body.user);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'AUTH_FAILED');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      minHeight="100vh"
      bgcolor="background.default"
      dir={direction}
      display="grid"
      sx={{
        placeItems: 'center',
        p: 2,
        backgroundImage: 'radial-gradient(circle at 12% 12%, #e8f0fe, transparent 35%)',
      }}
    >
      <Paper
        component="main"
        elevation={0}
        sx={{
          p: { xs: 3, sm: 5 },
          width: 'min(100%, 480px)',
          border: 1,
          borderColor: 'divider',
          borderRadius: 4,
          boxShadow: '0 18px 55px rgba(15, 23, 42, 0.08)',
        }}
      >
        <Stack component="form" gap={2.5} onSubmit={(event) => void submit(event)}>
          <Box textAlign="center" mb={1}>
            <Box
              sx={{
                width: 52,
                height: 52,
                mx: 'auto',
                mb: 2,
                borderRadius: 3,
                bgcolor: 'primary.main',
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
                fontSize: 26,
              }}
            >
              W
            </Box>
            <Typography variant="h4" component="h1" fontWeight={900} color="primary.main">
              Woo Ops
            </Typography>
            <Typography variant="h6" component="h2" fontWeight={700} mt={1}>
              {register ? copy.register : copy.signIn}
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              {locale === 'ar'
                ? 'مساحة عمل موحدة لإدارة الطلبات والتحليلات'
                : 'Your unified order operations workspace'}
            </Typography>
          </Box>
          {message && <Alert severity="warning">{message}</Alert>}
          {error && (
            <Alert severity="error">
              {error === 'AUTH_REGISTRATION_CLOSED'
                ? locale === 'ar'
                  ? 'تم إنشاء حساب المدير بالفعل. سجّل الدخول أو اطلب دعوة.'
                  : 'Owner account already exists. Sign in or request an invitation.'
                : error === 'AUTH_INVALID_INPUT' && register
                  ? locale === 'ar'
                    ? 'تأكد من البريد وكلمة مرور لا تقل عن 12 حرفًا.'
                    : 'Check the email and use a password of at least 12 characters.'
                  : `${copy.signIn}: ${copy.retry}`}
            </Alert>
          )}
          {register && (
            <TextField
              required
              label={copy.accountNameInput}
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
            />
          )}
          <TextField
            required
            type="email"
            label={copy.emailInput}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <TextField
            required
            type="password"
            label={copy.passwordInput}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={register ? 'new-password' : 'current-password'}
          />
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? <CircularProgress size={18} aria-label={copy.loading} /> : copy.submit}
          </Button>
          {registrationOpen && (
            <Button type="button" onClick={() => setRegister((value) => !value)}>
              {register ? copy.switchToLogin : copy.switchToRegister}
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

function OverviewWorkspace({
  copy,
  onSessionExpired,
}: {
  copy: Copy;
  onSessionExpired: () => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    const results = await Promise.allSettled([
      apiRequest<{ account: Account }>('/api/v1/account', onSessionExpired),
      apiRequest<ApiHealth>('/api/v1/operations/health', onSessionExpired),
      apiRequest<{ items: Connection[] }>('/api/v1/connections', onSessionExpired),
    ]);
    const accountResult = results[0];
    const healthResult = results[1];
    const connectionsResult = results[2];
    if (accountResult.status === 'fulfilled') setAccount(accountResult.value.account);
    if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
    if (connectionsResult.status === 'fulfilled')
      setConnections(connectionsResult.value.items ?? []);
    setFailed(results.some((result) => result.status === 'rejected'));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <StateBlock copy={copy} loading error={false} onRetry={() => void load()} />;
  if (!account && failed)
    return <StateBlock copy={copy} loading={false} error onRetry={() => void load()} />;
  return (
    <Stack gap={3} data-testid="admin-overview">
      <Box>
        <Typography variant="h4" component="h1" fontWeight={800}>
          {copy.overview}
        </Typography>
        <Typography color="text.secondary">{copy.readOnly}</Typography>
      </Box>
      {failed && <Alert severity="warning">{copy.partial}</Alert>}
      <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline">{copy.account}</Typography>
            <Typography variant="h5" component="p" fontWeight={800}>
              {account?.name ?? copy.empty}
            </Typography>
            <Typography color="text.secondary">
              {account?.timezone} · {account?.baseCurrency}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline">{copy.queue}</Typography>
            <Typography variant="h5" component="p" fontWeight={800}>
              {health?.health.queue.queued ?? '—'}
            </Typography>
            <Typography color="text.secondary">
              {copy.runner}: {health?.runner.running ? copy.connected : 'stopped'}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline">{copy.database}</Typography>
            <Typography variant="h5" component="p" fontWeight={800}>
              {health?.health.database ?? '—'}
            </Typography>
            <Typography color="text.secondary">
              Schema {health?.health.schemaVersion ?? '—'}
            </Typography>
          </CardContent>
        </Card>
      </Stack>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" fontWeight={800} mb={2}>
          {copy.connections}
        </Typography>
        {connections.length === 0 ? (
          <Alert severity="info">{copy.noConnections}</Alert>
        ) : (
          <Stack gap={1.5}>
            {connections.map((connection) => (
              <Stack
                key={connection.id}
                direction={{ xs: 'column', sm: 'row' }}
                gap={1}
                alignItems={{ sm: 'center' }}
              >
                <Box flex={1}>
                  <Typography fontWeight={700}>
                    {connection.displayName ?? connection.storeUrl}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {connection.platform} · {connection.syncStatus}
                  </Typography>
                </Box>
                <Chip size="small" label={`${connection.healthStatus} / ${connection.status}`} />
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function ConnectionsWorkspace({
  copy,
  onSessionExpired,
}: {
  copy: Copy;
  onSessionExpired: () => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [storeUrl, setStoreUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [webhookSetup, setWebhookSetup] = useState<{ connectionId: string; secret: string } | null>(
    null,
  );

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const body = await apiRequest<{ items: Connection[] }>(
        '/api/v1/connections',
        onSessionExpired,
      );
      setConnections(body.items ?? []);
    } catch (error) {
      setFailed(true);
      if (error instanceof AdminApiError && error.status === 403) setMessage('FORBIDDEN');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const action = async (connectionId: string, path: string, body: unknown) => {
    setMessage('');
    try {
      await apiRequest(path, onSessionExpired, writeOptions(body));
      setMessage(copy.syncQueued);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  const connect = async () => {
    try {
      const body = await apiRequest<{ authorizationUrl: string }>(
        '/api/v1/connections/woocommerce/authorize',
        onSessionExpired,
        writeOptions({ storeUrl }),
      );
      const destination = new URL(body.authorizationUrl);
      if (destination.protocol !== 'https:' || destination.pathname !== '/wc-auth/v1/authorize')
        throw new Error('CONNECTOR_URL_UNSAFE');
      window.location.assign(destination.toString());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  const configureWebhook = async (connectionId: string) => {
    const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    try {
      await apiRequest(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/webhook-secret`,
        onSessionExpired,
        writeOptions({ secret }),
      );
      setWebhookSetup({ connectionId, secret });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };

  if (loading) return <StateBlock copy={copy} loading error={false} onRetry={() => void load()} />;
  if (failed && message === 'FORBIDDEN')
    return (
      <StateBlock copy={copy} loading={false} error={false} forbidden onRetry={() => void load()} />
    );
  return (
    <Stack gap={3} data-testid="connections-workspace">
      <Box>
        <Typography variant="h4" component="h1" fontWeight={800}>
          {copy.connections}
        </Typography>
        <Typography color="text.secondary">{copy.readOnly}</Typography>
        <Button size="small" onClick={() => void load()} sx={{ mt: 1 }}>
          {copy.retry}
        </Button>
      </Box>
      {failed && <StateBlock copy={copy} loading={false} error onRetry={() => void load()} />}
      {message && <Alert severity={message === 'FORBIDDEN' ? 'warning' : 'info'}>{message}</Alert>}
      <Paper
        component="form"
        variant="outlined"
        sx={{ p: 2 }}
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
          <TextField
            fullWidth
            required
            label={copy.storeUrl}
            value={storeUrl}
            onChange={(event) => setStoreUrl(event.target.value)}
            placeholder="https://shop.example"
          />
          <Button type="submit" variant="contained" disabled={!storeUrl.trim()}>
            {copy.connect}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          {copy.externalOnly}
        </Typography>
      </Paper>
      {connections.length === 0 ? (
        <Alert severity="info">{copy.noConnections}</Alert>
      ) : (
        <Stack gap={2}>
          {connections.map((connection) => (
            <Card key={connection.id} variant="outlined">
              <CardContent>
                <Stack gap={1.5}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    gap={1}
                    alignItems={{ sm: 'center' }}
                  >
                    <Box flex={1}>
                      <Typography variant="h6" component="h2">
                        {connection.displayName ?? connection.storeUrl}
                      </Typography>
                      <Typography color="text.secondary">{connection.storeUrl}</Typography>
                    </Box>
                    <Chip label={`${connection.status} · ${connection.healthStatus}`} />
                  </Stack>
                  <Divider />
                  <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button
                      size="small"
                      onClick={() =>
                        void action(
                          connection.id,
                          `/api/v1/connections/${encodeURIComponent(connection.id)}/health-checks`,
                          {},
                        )
                      }
                    >
                      {copy.healthCheck}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        void action(
                          connection.id,
                          `/api/v1/connections/${encodeURIComponent(connection.id)}/sync-runs`,
                          { idempotencyKey: crypto.randomUUID() },
                        )
                      }
                    >
                      {copy.sync}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        void action(
                          connection.id,
                          `/api/v1/connections/${encodeURIComponent(connection.id)}/sync-runs/incremental`,
                          { idempotencyKey: crypto.randomUUID() },
                        )
                      }
                    >
                      {copy.incremental}
                    </Button>
                    <Button size="small" onClick={() => void configureWebhook(connection.id)}>
                      {copy.webhookSetup}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        void action(
                          connection.id,
                          `/api/v1/connections/${encodeURIComponent(connection.id)}/reconcile`,
                          { idempotencyKey: crypto.randomUUID() },
                        )
                      }
                    >
                      {copy.reconcile}
                    </Button>
                  </Stack>
                  {webhookSetup?.connectionId === connection.id && (
                    <Alert severity="info">
                      <Stack gap={1}>
                        <Typography variant="body2">{copy.webhookInstructions}</Typography>
                        <TextField
                          label="Delivery URL"
                          value={`${window.location.origin}/api/v1/webhooks/woocommerce/${encodeURIComponent(connection.id)}`}
                          slotProps={{ input: { readOnly: true } }}
                          size="small"
                        />
                        <TextField
                          label="Secret"
                          value={webhookSetup.secret}
                          slotProps={{ input: { readOnly: true } }}
                          size="small"
                        />
                      </Stack>
                    </Alert>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    {connection.syncOrdersCount} orders · {connection.syncCatalogCount} catalog
                    items
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function FieldMappingsWorkspace({
  copy,
  onSessionExpired,
}: {
  copy: Copy;
  onSessionExpired: () => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [catalog, setCatalog] = useState<FieldCatalog[]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [targetFacet, setTargetFacet] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');

  const loadConnections = async () => {
    const body = await apiRequest<{ items: Connection[] }>('/api/v1/connections', onSessionExpired);
    setConnections(body.items ?? []);
    const next = connectionId || body.items?.[0]?.id || '';
    setConnectionId(next);
    return next;
  };
  const loadFields = async (id: string) => {
    if (!id) {
      setCatalog([]);
      setMappings([]);
      return;
    }
    const body = await apiRequest<{ catalog: FieldCatalog[]; mappings: FieldMapping[] }>(
      `/api/v1/connections/${encodeURIComponent(id)}/fields`,
      onSessionExpired,
    );
    setCatalog(body.catalog ?? []);
    setMappings(body.mappings ?? []);
  };
  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const id = await loadConnections();
      await loadFields(id);
    } catch (error) {
      setFailed(true);
      if (error instanceof AdminApiError && error.status === 403) setMessage('FORBIDDEN');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!loading) void loadFields(connectionId).catch(() => setFailed(true));
  }, [connectionId]);

  const saveMapping = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connectionId) return;
    try {
      await apiRequest(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/field-mappings`,
        onSessionExpired,
        {
          ...writeOptions({ sourceKey, label, type, ...(targetFacet ? { targetFacet } : {}) }),
          method: 'PUT',
        },
      );
      setMessage(copy.mappingSaved);
      await loadFields(connectionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  const backfill = async (mappingId: string) => {
    try {
      await apiRequest(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/field-mappings/backfill`,
        onSessionExpired,
        writeOptions({ mappingId, idempotencyKey: crypto.randomUUID() }),
      );
      setMessage(copy.mappingSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };

  if (loading) return <StateBlock copy={copy} loading error={false} onRetry={() => void load()} />;
  if (failed && message === 'FORBIDDEN')
    return (
      <StateBlock copy={copy} loading={false} error={false} forbidden onRetry={() => void load()} />
    );
  return (
    <Stack gap={3} data-testid="field-mappings-workspace">
      <Box>
        <Typography variant="h4" component="h1" fontWeight={800}>
          {copy.mappings}
        </Typography>
        <Typography color="text.secondary">{copy.readOnly}</Typography>
      </Box>
      {failed && <StateBlock copy={copy} loading={false} error onRetry={() => void load()} />}
      {message && <Alert severity={message === 'FORBIDDEN' ? 'warning' : 'info'}>{message}</Alert>}
      <FormControl fullWidth size="small">
        <InputLabel id="admin-field-connection-label">{copy.selectConnection}</InputLabel>
        <Select
          labelId="admin-field-connection-label"
          label={copy.selectConnection}
          value={connectionId}
          onChange={(event) => setConnectionId(event.target.value)}
        >
          {connections.map((connection) => (
            <MenuItem key={connection.id} value={connection.id}>
              {connection.displayName ?? connection.storeUrl}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {!connectionId ? (
        <Alert severity="info">{copy.noConnections}</Alert>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" component="h2" mb={2}>
              {copy.fieldCatalog}
            </Typography>
            {catalog.length === 0 ? (
              <Alert severity="info">{copy.noCatalog}</Alert>
            ) : (
              <TableContainer>
                <Table size="small" aria-label={copy.fieldCatalog}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{copy.sourceKey}</TableCell>
                      <TableCell>{copy.type}</TableCell>
                      <TableCell>{copy.status}</TableCell>
                      <TableCell>{copy.progress}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {catalog.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <code>{item.sourceKey}</code>
                        </TableCell>
                        <TableCell>{item.inferredType}</TableCell>
                        <TableCell>
                          <Chip size="small" label={item.sensitivity} />
                        </TableCell>
                        <TableCell>{item.occurrences}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
          <Paper
            component="form"
            variant="outlined"
            sx={{ p: 2 }}
            onSubmit={(event) => void saveMapping(event)}
          >
            <Typography variant="h6" component="h2" mb={2}>
              {copy.fieldMappings}
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
              <TextField
                required
                fullWidth
                label={copy.sourceKey}
                value={sourceKey}
                onChange={(event) => setSourceKey(event.target.value)}
              />
              <TextField
                required
                fullWidth
                label={copy.label}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="admin-field-type-label">{copy.type}</InputLabel>
                <Select
                  labelId="admin-field-type-label"
                  label={copy.type}
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                >
                  {['text', 'number', 'money', 'boolean', 'date', 'enum', 'entity'].map(
                    (option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ),
                  )}
                </Select>
              </FormControl>
              <TextField
                label={copy.targetFacet}
                value={targetFacet}
                onChange={(event) => setTargetFacet(event.target.value)}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={!sourceKey.trim() || !label.trim()}
              >
                {copy.saveMapping}
              </Button>
            </Stack>
          </Paper>
          {mappings.length === 0 ? (
            <Alert severity="info">{copy.empty}</Alert>
          ) : (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <TableContainer>
                <Table size="small" aria-label={copy.fieldMappings}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{copy.sourceKey}</TableCell>
                      <TableCell>{copy.label}</TableCell>
                      <TableCell>{copy.type}</TableCell>
                      <TableCell>{copy.actions}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {mappings.map((mapping) => (
                      <TableRow key={mapping.id}>
                        <TableCell>
                          <code>{mapping.sourceKey}</code>
                        </TableCell>
                        <TableCell>{mapping.label}</TableCell>
                        <TableCell>{mapping.type}</TableCell>
                        <TableCell>
                          <Button size="small" onClick={() => void backfill(mapping.id)}>
                            {copy.backfill}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

function SettingsWorkspace({
  copy,
  onSessionExpired,
}: {
  copy: Copy;
  onSessionExpired: () => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [locale, setLocale] = useState<'ar-EG' | 'en-US'>('ar-EG');
  const [direction, setDirection] = useState<AdminDirection>('rtl');
  const [timezone, setTimezone] = useState('Africa/Cairo');
  const [baseCurrency, setBaseCurrency] = useState('EGP');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const body = await apiRequest<{ account: Account }>('/api/v1/account', onSessionExpired);
      setAccount(body.account);
      setName(body.account.name);
      setLocale(body.account.locale);
      setDirection(body.account.direction);
      setTimezone(body.account.timezone);
      setBaseCurrency(body.account.baseCurrency);
    } catch (error) {
      setFailed(true);
      if (error instanceof AdminApiError && error.status === 403) setMessage('FORBIDDEN');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const body = await apiRequest<{ account: Account }>('/api/v1/account', onSessionExpired, {
        ...writeOptions({ name, locale, direction, timezone, baseCurrency }),
        method: 'PATCH',
      });
      setAccount(body.account);
      setMessage(copy.saved);
      localStorage.setItem('woo-ops-locale', body.account.locale === 'ar-EG' ? 'ar' : 'en');
      localStorage.setItem('woo-ops-direction', body.account.direction);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiRequest(
        '/api/v1/auth/password/change',
        onSessionExpired,
        writeOptions({ currentPassword, newPassword }),
      );
      setCurrentPassword('');
      setNewPassword('');
      setMessage(copy.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  if (loading) return <StateBlock copy={copy} loading error={false} onRetry={() => void load()} />;
  if (failed && message === 'FORBIDDEN')
    return (
      <StateBlock copy={copy} loading={false} error={false} forbidden onRetry={() => void load()} />
    );
  return (
    <Stack gap={3} data-testid="settings-workspace">
      <Typography variant="h4" component="h1" fontWeight={800}>
        {copy.settings}
      </Typography>
      {failed && <StateBlock copy={copy} loading={false} error onRetry={() => void load()} />}
      {message && <Alert severity="info">{message}</Alert>}
      <Paper
        component="form"
        variant="outlined"
        sx={{ p: 2 }}
        onSubmit={(event) => void save(event)}
      >
        <Typography variant="h6" component="h2" mb={2}>
          {copy.profile}
        </Typography>
        <Stack gap={2}>
          <TextField
            label={copy.accountName}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
            <FormControl fullWidth>
              <InputLabel id="admin-locale-label">{copy.locale}</InputLabel>
              <Select
                labelId="admin-locale-label"
                label={copy.locale}
                value={locale}
                onChange={(event) => setLocale(event.target.value as 'ar-EG' | 'en-US')}
              >
                <MenuItem value="ar-EG">العربية</MenuItem>
                <MenuItem value="en-US">English</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="admin-direction-label">{copy.direction}</InputLabel>
              <Select
                labelId="admin-direction-label"
                label={copy.direction}
                value={direction}
                onChange={(event) => setDirection(event.target.value as AdminDirection)}
              >
                <MenuItem value="rtl">RTL</MenuItem>
                <MenuItem value="ltr">LTR</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label={copy.timezone}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
            <TextField
              fullWidth
              label={copy.baseCurrency}
              value={baseCurrency}
              onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())}
              inputProps={{ maxLength: 3 }}
            />
          </Stack>
          <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}>
            {copy.save}
          </Button>
        </Stack>
      </Paper>
      <Paper
        component="form"
        variant="outlined"
        sx={{ p: 2 }}
        onSubmit={(event) => void changePassword(event)}
      >
        <Typography variant="h6" component="h2" mb={2}>
          {copy.password}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
          <TextField
            required
            type="password"
            label={copy.currentPassword}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <TextField
            required
            type="password"
            label={copy.newPassword}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Button type="submit" variant="outlined">
            {copy.save}
          </Button>
        </Stack>
      </Paper>
      {!account && <Alert severity="warning">{copy.partial}</Alert>}
    </Stack>
  );
}

function MembersWorkspace({
  copy,
  onSessionExpired,
}: {
  copy: Copy;
  onSessionExpired: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('operator');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    setLoading(true);
    setFailed(false);
    setForbidden(false);
    const results = await Promise.allSettled([
      apiRequest<{ items: Member[] }>('/api/v1/members', onSessionExpired),
      apiRequest<{ items: Invitation[] }>('/api/v1/members/invitations', onSessionExpired),
    ]);
    if (results[0].status === 'fulfilled') setMembers(results[0].value.items ?? []);
    if (results[1].status === 'fulfilled') setInvitations(results[1].value.items ?? []);
    const isForbidden = results.some(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof AdminApiError &&
        result.reason.status === 403,
    );
    setForbidden(isForbidden);
    setFailed(results.some((result) => result.status === 'rejected') && !isForbidden);
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);
  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiRequest(
        '/api/v1/members/invitations',
        onSessionExpired,
        writeOptions({ email, role, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() }),
      );
      setEmail('');
      setMessage(copy.inviteSent);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  const revoke = async (userId: string) => {
    try {
      await apiRequest(`/api/v1/members/${encodeURIComponent(userId)}`, onSessionExpired, {
        ...writeOptions({}),
        method: 'DELETE',
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  if (loading) return <StateBlock copy={copy} loading error={false} onRetry={() => void load()} />;
  if (forbidden)
    return (
      <StateBlock copy={copy} loading={false} error={false} forbidden onRetry={() => void load()} />
    );
  return (
    <Stack gap={3} data-testid="members-workspace">
      <Typography variant="h4" component="h1" fontWeight={800}>
        {copy.membersTitle}
      </Typography>
      {failed && <StateBlock copy={copy} loading={false} error onRetry={() => void load()} />}
      {message && <Alert severity="info">{message}</Alert>}
      <Paper
        component="form"
        variant="outlined"
        sx={{ p: 2 }}
        onSubmit={(event) => void invite(event)}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
          <TextField
            required
            type="email"
            fullWidth
            label={copy.email}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FormControl sx={{ minWidth: 150 }}>
            <InputLabel id="member-role-label">{copy.role}</InputLabel>
            <Select
              labelId="member-role-label"
              label={copy.role}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <MenuItem value="admin">admin</MenuItem>
              <MenuItem value="operator">operator</MenuItem>
              <MenuItem value="viewer">viewer</MenuItem>
            </Select>
          </FormControl>
          <Button type="submit" variant="contained">
            {copy.invite}
          </Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <TableContainer>
          <Table size="small" aria-label={copy.membersTitle}>
            <TableHead>
              <TableRow>
                <TableCell>{copy.email}</TableCell>
                <TableCell>{copy.role}</TableCell>
                <TableCell>{copy.status}</TableCell>
                <TableCell>{copy.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>{member.status}</TableCell>
                  <TableCell>
                    {member.status === 'active' && (
                      <Button size="small" onClick={() => void revoke(member.userId)}>
                        {copy.revoke}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {members.length === 0 && (
          <Typography color="text.secondary" py={2}>
            {copy.empty}
          </Typography>
        )}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" mb={1}>
          {copy.pendingInvitations}
        </Typography>
        {invitations.length === 0 ? (
          <Typography color="text.secondary">{copy.empty}</Typography>
        ) : (
          invitations.map((invitation) => (
            <Stack
              key={invitation.id}
              direction="row"
              justifyContent="space-between"
              gap={1}
              py={1}
            >
              <span>{invitation.email}</span>
              <Chip
                size="small"
                label={`${invitation.role} · ${invitation.acceptedAt ? 'accepted' : 'pending'}`}
              />
            </Stack>
          ))
        )}
      </Paper>
    </Stack>
  );
}

function OperationsWorkspace({
  copy,
  onSessionExpired,
}: {
  copy: Copy;
  onSessionExpired: () => void;
}) {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const [jobs, setJobs] = useState<OperationJob[]>([]);
  const [deadLetters, setDeadLetters] = useState<OperationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    setLoading(true);
    setFailed(false);
    const results = await Promise.allSettled([
      apiRequest<ApiHealth>('/api/v1/operations/health', onSessionExpired),
      apiRequest<{ usage: ApiUsage }>('/api/v1/operations/usage', onSessionExpired),
      apiRequest<{ items: OperationJob[] }>('/api/v1/operations/jobs?limit=50', onSessionExpired),
      apiRequest<{ items: OperationJob[] }>(
        '/api/v1/operations/dead-letters?limit=50',
        onSessionExpired,
      ),
    ]);
    if (results[0].status === 'fulfilled') setHealth(results[0].value);
    if (results[1].status === 'fulfilled') setUsage(results[1].value.usage);
    if (results[2].status === 'fulfilled') setJobs(results[2].value.items ?? []);
    if (results[3].status === 'fulfilled') setDeadLetters(results[3].value.items ?? []);
    setFailed(results.some((result) => result.status === 'rejected'));
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);
  const jobAction = async (jobId: string, action: 'cancel' | 'replay') => {
    const path =
      action === 'cancel'
        ? `/api/v1/operations/jobs/${encodeURIComponent(jobId)}/cancel`
        : `/api/v1/operations/dead-letters/${encodeURIComponent(jobId)}/replay`;
    try {
      await apiRequest(path, onSessionExpired, writeOptions({}));
      setMessage(copy.syncQueued);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  const runMaintenance = async () => {
    try {
      await apiRequest(
        '/api/v1/operations/maintenance',
        onSessionExpired,
        writeOptions({
          idempotencyKey: `maintenance:${Date.now()}`,
        }),
      );
      setMessage(copy.maintenanceQueued);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
    }
  };
  if (loading) return <StateBlock copy={copy} loading error={false} onRetry={() => void load()} />;
  return (
    <Stack gap={3} data-testid="operations-workspace">
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={800}>
            {copy.operations}
          </Typography>
          <Typography color="text.secondary">{copy.readOnly}</Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button variant="outlined" onClick={() => void runMaintenance()}>
            {copy.runMaintenance}
          </Button>
          <Button variant="outlined" onClick={() => void load()}>
            {copy.retry}
          </Button>
        </Stack>
      </Stack>
      {failed && <StateBlock copy={copy} loading={false} error onRetry={() => void load()} />}
      {message && <Alert severity="info">{message}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline">{copy.usage}</Typography>
            <Typography variant="h5" component="p">
              {usage?.total ?? 0}
            </Typography>
            <Typography color="text.secondary">
              {usage?.running ?? 0} running · {usage?.failed ?? 0} failed
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline">{copy.queue}</Typography>
            <Typography variant="h5" component="p">
              {health?.health.queue.queued ?? 0}
            </Typography>
            <Typography color="text.secondary">
              {health?.health.queue.deadLettered ?? 0} dead letters · {health?.runner.active ?? 0}{' '}
              active
            </Typography>
          </CardContent>
        </Card>
      </Stack>
      <JobTable copy={copy} jobs={jobs} onAction={jobAction} emptyText={copy.noJobs} />
      <Box>
        <Typography variant="h6" component="h2" mb={1}>
          {copy.deadLetters}
        </Typography>
        <JobTable
          copy={copy}
          jobs={deadLetters}
          onAction={jobAction}
          emptyText={copy.noDeadLetters}
          deadLetters
        />
      </Box>
    </Stack>
  );
}

function JobTable({
  copy,
  jobs,
  onAction,
  emptyText,
  deadLetters = false,
}: {
  copy: Copy;
  jobs: OperationJob[];
  onAction: (jobId: string, action: 'cancel' | 'replay') => void;
  emptyText: string;
  deadLetters?: boolean;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <TableContainer>
        <Table size="small" aria-label={copy.jobs}>
          <TableHead>
            <TableRow>
              <TableCell>{copy.status}</TableCell>
              <TableCell>{copy.jobs}</TableCell>
              <TableCell>{copy.progress}</TableCell>
              <TableCell>{copy.actions}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell>
                  <Chip size="small" label={job.status} />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{job.type}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {job.id}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 150 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, job.progress)}
                    aria-label={`${copy.progress} ${job.progress}%`}
                  />
                  <Typography variant="caption">
                    {job.progress}% · {job.attempts}/{job.maxAttempts}
                  </Typography>
                  {job.lastError && (
                    <Typography variant="caption" color="error" display="block">
                      {job.lastError}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {deadLetters ? (
                    <Button size="small" onClick={() => onAction(job.id, 'replay')}>
                      {copy.replay}
                    </Button>
                  ) : (
                    ['queued', 'running'].includes(job.status) && (
                      <Button size="small" onClick={() => onAction(job.id, 'cancel')}>
                        {copy.cancel}
                      </Button>
                    )
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {jobs.length === 0 && (
        <Typography color="text.secondary" py={2}>
          {emptyText}
        </Typography>
      )}
    </Paper>
  );
}

export function AdminWorkspace({
  section,
  locale,
  onSessionExpired,
}: {
  section: AdminSection;
  locale: AdminLocale;
  onSessionExpired: () => void;
}) {
  const copy = translations[locale];
  if (section === 'overview')
    return <OverviewWorkspace copy={copy} onSessionExpired={onSessionExpired} />;
  if (section === 'connections')
    return <ConnectionsWorkspace copy={copy} onSessionExpired={onSessionExpired} />;
  if (section === 'field-mappings')
    return <FieldMappingsWorkspace copy={copy} onSessionExpired={onSessionExpired} />;
  if (section === 'settings')
    return <SettingsWorkspace copy={copy} onSessionExpired={onSessionExpired} />;
  if (section === 'members')
    return <MembersWorkspace copy={copy} onSessionExpired={onSessionExpired} />;
  return <OperationsWorkspace copy={copy} onSessionExpired={onSessionExpired} />;
}

export const adminLabel = (section: AdminSection, locale: AdminLocale): string =>
  translations[locale][section === 'field-mappings' ? 'mappings' : section];

export const sessionExpiredLabel = (locale: AdminLocale): string =>
  translations[locale].sessionExpired;

export const signOutLabel = (locale: AdminLocale): string => translations[locale].signOut;
