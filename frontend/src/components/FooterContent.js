import { useTheme } from "@mui/material/styles";
import Grid from '@mui/material/Grid';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import { Typography } from "@mui/material";
import { usePilot } from '../context/PilotContext';

const FooterContent = () => {
    const theme = useTheme();
    const { pilot } = usePilot();

    const textShadowStyle = {
        textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)'
    };

    const fundingText = pilot === 'hu'
        ? 'Funded by Antia Horizon 2020 Framework Programme of the European Union under grant agreement No 101096354'
        : 'Funded by the Horizon 2020 Framework Programme of the European Union under grant agreement No 101103998';

    return (
        <Container maxWidth={'xl'}>
            <Grid container spacing={5} py={3}
                  justifyContent={'center'} alignItems="center">
                <Grid item xs={12} md={4} sx={{ textAlign: 'left', ...textShadowStyle}}>
                    <Typography color={'white'}>© Enpower Consortium 2026. All rights reserved.</Typography>
                </Grid>

                <Grid item xs={12} md={8} sx={{
                    display: 'flex',
                    flexDirection: 'row',
                    justifyItems: 'center',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    ...textShadowStyle
                }}>
                    <Box component="img" src={'/images/eu_flag.jpg'} alt="EU Flag" sx={{ height: 24, marginRight: 2 }} />
                    <Typography color={'white'}>{fundingText}</Typography>
                </Grid>
            </Grid>
        </Container>
    );
}

export default FooterContent;
