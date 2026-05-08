import { theme, type ThemeConfig } from 'antd';

const fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';

export const lightThemeConfig: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#00b96b',
    colorSuccess: '#00b96b',
    colorInfo: '#1677ff',
    colorBgLayout: '#f5f7f6',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#dce4e1',
    colorBorderSecondary: '#edf1ef',
    colorText: '#1f2933',
    colorTextSecondary: '#667085',
    colorTextTertiary: '#8a98a8',
    borderRadius: 8,
    fontFamily,
    boxShadowTertiary: '0 16px 48px rgba(15, 23, 42, 0.12)',
  },
  components: {
    Layout: {
      bodyBg: '#f5f7f6',
      headerBg: 'rgba(255, 255, 255, 0.76)',
      siderBg: '#ffffff',
      triggerBg: '#f1f5f3',
      triggerColor: '#1f2933',
    },
    Menu: {
      itemBorderRadius: 8,
      subMenuItemBorderRadius: 8,
    },
  },
};

export const darkThemeConfig: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#00b96b',
    colorSuccess: '#00b96b',
    colorInfo: '#5b9dff',
    colorBgLayout: '#1a1a2e',
    colorBgContainer: '#242438',
    colorBgElevated: '#2b2b42',
    colorBorder: '#3a3a52',
    colorBorderSecondary: '#303049',
    colorText: '#f2f5f7',
    colorTextSecondary: '#b7c0ca',
    colorTextTertiary: '#8d99a6',
    borderRadius: 8,
    fontFamily,
    boxShadowTertiary: '0 18px 56px rgba(0, 0, 0, 0.42)',
  },
  components: {
    Layout: {
      bodyBg: '#1a1a2e',
      headerBg: 'rgba(26, 26, 46, 0.72)',
      siderBg: '#242438',
      triggerBg: '#2f2f48',
      triggerColor: '#f2f5f7',
    },
    Menu: {
      itemBg: '#242438',
      subMenuItemBg: '#242438',
      itemBorderRadius: 8,
      subMenuItemBorderRadius: 8,
    },
  },
};
