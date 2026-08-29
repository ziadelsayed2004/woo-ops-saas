import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Toolbar,
  Typography,
} from '@mui/material';

export function App() {
  return (
    <Box minHeight="100vh" bgcolor="#f6f8fb">
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Woo Ops
          </Typography>
          <Button color="inherit">English / العربية</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Card>
          <CardContent>
            <Typography variant="h4" gutterBottom>
              لوحة تشغيل الطلبات
            </Typography>
            <Typography color="text.secondary">
              الأساس جاهز: واجهة عربية RTL، API محلي، وSQLite قابل للنسخ الاحتياطي.
            </Typography>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
