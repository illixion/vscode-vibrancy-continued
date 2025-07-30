Add-Type -AssemblyName PresentationFramework

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="Color Bars Background"
        Height="400" Width="480"
        WindowStartupLocation="CenterScreen"
        ResizeMode="NoResize" Background="Black">
    <StackPanel>
        <Rectangle Height="60" Fill="Red"/>
        <Rectangle Height="60" Fill="Green"/>
        <Rectangle Height="60" Fill="Blue"/>
        <Rectangle Height="60" Fill="Yellow"/>
        <Rectangle Height="60" Fill="Magenta"/>
        <Rectangle Height="60" Fill="Cyan"/>
    </StackPanel>
</Window>
"@

# Load XAML into WPF window
$reader = (New-Object System.Xml.XmlNodeReader $xaml)
$window = [Windows.Markup.XamlReader]::Load($reader)

# Show the window
$null = $window.Show()

# Keep script alive while the window is open
while ($window.IsVisible) {
    Start-Sleep -Milliseconds 200
}
