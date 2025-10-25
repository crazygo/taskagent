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
    if (options.length === 0) return;

    if (key.leftArrow) {
      const currentIndex = options.indexOf(selectedValue);
      const newIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
      onSelect(options[newIndex]!);
    } else if (key.rightArrow) {
      const currentIndex = options.indexOf(selectedValue);
      const newIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
      onSelect(options[newIndex]!);
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

// Driver rendered as tabs style with dark background
const DriverTabs = <T extends string>({ options, selectedValue, onSelect, isFocused }: Omit<OptionGroupProps<T>, 'title'>) => {
  useInput((input, key) => {
    if (key.ctrl && input === 'n') {
        const currentIndex = options.indexOf(selectedValue);
        const newIndex = (currentIndex + 1) % options.length;
        onSelect(options[newIndex]!);
        return; // 处理完后直接返回
    }

    // 2. 仅在组件聚焦时有效的左右箭头键
    if (!isFocused) return;

    if (options.length === 0) return;

    if (key.leftArrow) {
      const currentIndex = options.indexOf(selectedValue);
      const newIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
      onSelect(options[newIndex]!);
    } else if (key.rightArrow) {
      const currentIndex = options.indexOf(selectedValue);
      const newIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
      onSelect(options[newIndex]!);
    }
  }, { isActive: true }); // 保持全局监听

  return (
    <Box flexDirection="row" backgroundColor="gray" width="100%" paddingX={1}>
      {options.map(option => {
        const selected = selectedValue === option;
        const color = selected ? 'black' : (isFocused ? 'white' : 'gray');
        const backgroundColor = selected ? 'cyan' : 'gray';
        return (
          <Box key={option} marginRight={1} backgroundColor={backgroundColor as any}>
            <Text color={color as any}>{` ${option} `}</Text>
          </Box>
        );
      })}
      <Box marginLeft={2} backgroundColor="gray"><Text color={isFocused ? 'blue' : 'gray'}>Press Ctrl+N to switch view</Text></Box>
      <Box flexGrow={1} backgroundColor="gray"></Box>
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

// Component for just the Driver tabs (above input)
export const DriverControls = <TDriver extends string>({
  driverOptions,
  selectedDriver,
  onDriverChange,
  isDriverFocused,
}: {
  driverOptions: readonly TDriver[];
  selectedDriver: TDriver;
  onDriverChange: (value: TDriver) => void;
  isDriverFocused: boolean;
}) => (
  <Box width="100%">
    <DriverTabs
      options={driverOptions}
      selectedValue={selectedDriver}
      onSelect={onDriverChange}
      isFocused={isDriverFocused}
    />
  </Box>
);

// Component for Kernel and instructions (below input)
export const KernelControls = <TKernel extends string>({
  kernelOptions,
  selectedKernel,
  onKernelChange,
  isKernelFocused,
}: {
  kernelOptions: readonly TKernel[];
  selectedKernel: TKernel;
  onKernelChange: (value: TKernel) => void;
  isKernelFocused: boolean;
}) => (
  <Box paddingX={1} flexDirection="column">
    <OptionGroup
      title="Kernel"
      options={kernelOptions}
      selectedValue={selectedKernel}
      onSelect={onKernelChange}
      isFocused={isKernelFocused}
    />
    <Text color="gray">(Press [Tab] to switch focus; use ←/→ to change selection)</Text>
  </Box>
);

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
    {/* Driver first (tabs style), then Kernel below it */}
    <DriverTabs
      options={driverOptions}
      selectedValue={selectedDriver}
      onSelect={onDriverChange}
      isFocused={isDriverFocused}
    />
    <OptionGroup
      title="Kernel"
      options={kernelOptions}
      selectedValue={selectedKernel}
      onSelect={onKernelChange}
      isFocused={isKernelFocused}
    />
    <Text color="gray">(Press [Tab] to switch focus; use ←/→ to change selection)</Text>
  </Box>
);
