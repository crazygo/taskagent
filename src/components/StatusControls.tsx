import React from 'react';
import { Box, Text, useInput } from 'ink';

interface OptionGroupProps<T extends string> {
  title: string;
  options: readonly T[];
  selectedValue: T;
  onSelect: (value: T) => void;
  isFocused: boolean;
}

const OptionGroup = <T extends string>({ title, options, selectedValue, onSelect, isFocused }: OptionGroupProps<T>) => {
  useInput((input, key) => {
    if (!isFocused) return;

    if (key.leftArrow) {
      const currentIndex = options.indexOf(selectedValue);
      const newIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
      onSelect(options[newIndex]);
    } else if (key.rightArrow) {
      const currentIndex = options.indexOf(selectedValue);
      const newIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
      onSelect(options[newIndex]);
    }
  }, { isActive: isFocused });

  return (
    <Box>
      <Box><Text color={isFocused ? 'blue' : 'white'}>{title}:</Text></Box>
      {options.map(option => (
        <Box key={option} marginRight={2}>
          <Text color={isFocused ? 'blue' : 'white'}>
            {selectedValue === option ? '(◉)' : '(○)'} {option}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

interface StatusControlsProps<TKernel extends string, TDriver extends string> {
  kernelOptions: readonly TKernel[];
  driverOptions: readonly TDriver[];
  selectedKernel: TKernel;
  selectedDriver: TDriver;
  onKernelChange: (value: TKernel) => void;
  onDriverChange: (value: TDriver) => void;
  isKernelFocused: boolean;
  isDriverFocused: boolean;
}

export const StatusControls = <TKernel extends string, TDriver extends string>({
  kernelOptions,
  driverOptions,
  selectedKernel,
  selectedDriver,
  onKernelChange,
  onDriverChange,
  isKernelFocused,
  isDriverFocused,
}: StatusControlsProps<TKernel, TDriver>) => (
  <Box paddingX={1} flexDirection="column">
    <OptionGroup
      title="Kernel"
      options={kernelOptions}
      selectedValue={selectedKernel}
      onSelect={onKernelChange}
      isFocused={isKernelFocused}
    />
    <OptionGroup
      title="Driver"
      options={driverOptions}
      selectedValue={selectedDriver}
      onSelect={onDriverChange}
      isFocused={isDriverFocused}
    />
    <Text color="gray">(Press [Tab] to switch between controls)</Text>
  </Box>
);
