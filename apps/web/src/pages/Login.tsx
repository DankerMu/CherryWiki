import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

type LocationState = {
  from?: string;
};

type LoginFormValues = {
  email: string;
  password: string;
};

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(values: LoginFormValues): Promise<void> {
    setIsSubmitting(true);
    setError(null);

    try {
      await login(values.email, values.password);
      const state = location.state as LocationState | null;
      void navigate(state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(getLoginErrorMessage(err, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <Card className="login-panel">
        <Typography.Text className="eyebrow">{t('common.app.name')}</Typography.Text>
        <Typography.Title level={1}>{t('login.page.title')}</Typography.Title>
        <Typography.Paragraph className="login-copy">{t('login.page.subtitle')}</Typography.Paragraph>

        {error !== null ? (
          <Alert className="login-error" message={error} role="alert" showIcon type="error" />
        ) : null}

        <Form<LoginFormValues>
          className="login-form"
          layout="vertical"
          onFinish={(values) => {
            void submitLogin(values);
          }}
        >
          <Form.Item
            label={t('login.form.email')}
            name="email"
            rules={[
              { required: true, message: t('login.form.emailRequired') },
              { type: 'email', message: t('login.form.emailInvalid') },
            ]}
          >
            <Input autoComplete="email" prefix={<MailOutlined />} type="email" />
          </Form.Item>

          <Form.Item
            label={t('login.form.password')}
            name="password"
            rules={[{ required: true, message: t('login.form.passwordRequired') }]}
          >
            <Input.Password autoComplete="current-password" prefix={<LockOutlined />} />
          </Form.Item>

          <Button block htmlType="submit" loading={isSubmitting} type="primary">
            {isSubmitting ? t('login.form.submitting') : t('login.form.submit')}
          </Button>
        </Form>
      </Card>
    </main>
  );
}

function getLoginErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') {
      return t('login.error.invalidCredentials');
    }

    if (error.code === 'ACCOUNT_LOCKED') {
      return t('login.error.accountLocked');
    }

    if (error.code === 'ACCOUNT_DISABLED') {
      return t('login.error.accountDisabled');
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return t('login.error.generic');
}
