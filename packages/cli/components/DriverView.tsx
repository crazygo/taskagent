import React from 'react';
import { getDriverByLabel } from '../drivers/registry.js';

interface DriverViewProps {
  selectedTab: string;
}

export const DriverView: React.FC<DriverViewProps> = ({ selectedTab }) => {
    const driverEntry = getDriverByLabel(selectedTab);

    if (!driverEntry) {
        // This could be a fallback view or null
        // For now, let's render nothing if no view driver is found.
        return null;
    }

    const ViewComponent = driverEntry.component;
    
    // All view components expect an `isActive` prop.
    // Here, we are always passing true because the DriverView itself
    // is only rendered for the *active* tab.
    return <ViewComponent isActive={true} label={driverEntry.label} />;
};
