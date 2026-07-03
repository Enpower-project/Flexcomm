import React from 'react';
import { Container, Paper, Typography } from '@mui/material';

const EmptyStateSection = () => {
    return (
        <Container sx={{ textAlign: 'center', py: 5, minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
                <Typography variant="h5" gutterBottom>
                    Welcome, Administrator!
                </Typography>
                <Typography variant="body1" color="textSecondary">
                    Please select a user from the dropdown above to view their self-consumption optimization data.
                </Typography>
            </Paper>
        </Container>
    );
};

export default EmptyStateSection;