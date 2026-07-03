import React from 'react';
import {
    Box,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Typography,
    Chip
} from '@mui/material';
import { Users } from 'lucide-react';

const UserSelection = ({ selectedUser, users, handleUserChange }) => {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Users size={18} style={{ color: '#6b7280' }} />
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    User:
                </Typography>
            </Box>

            <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
                <InputLabel id="user-select-label" 
                sx={{
                    '&.Mui-focused': {
                        color: 'selection.main'
                    }
                }}>
                    Select User
                </InputLabel>
                <Select
                    labelId="user-select-label"
                    id="user-select"
                    value={selectedUser?.username ?? 'Unknown User'}
                    label="Select User"
                    onChange={handleUserChange}
                    sx={{
                        bgcolor: 'background.paper',
                        color: 'text.secondary',
                        borderRadius: 2,
                        '& .MuiOutlinedInput-notchedOutline': {
                            borderColor: 'divider',
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                            borderColor: 'selection.hover',
                        },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                            borderColor: 'selection.main',
                        },
                    }}
                >
                    {users.map((user) => (
                        <MenuItem key={user.id} value={user.username}>
                            {user.displayName}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {selectedUser && (
                <Chip
                    label={`Viewing: ${selectedUser?.displayName ?? 'Unknown User'}`}
                    size="small"
                    variant="outlined"
                    color="selection.main"
                    sx={{
                        borderRadius: 2,
                        bgcolor: 'transparent',
                        // borderColor: 'selection.hover',
                        // color: 'selection.main',
                        fontSize: '0.75rem',
                        border: 'none',
                        minWidth: 0,
                        overflow: 'visible',
                        maxHeight: '80%',
                        '& .MuiChip-label': {
                            whiteSpace: 'normal',
                            overflow: 'visible',
                            textOverflow: 'unset',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            display: 'block',
                            color: 'primary.dark'
                        },
                    }}
                />
            )}
        </Box>
    );
};

export default UserSelection;
